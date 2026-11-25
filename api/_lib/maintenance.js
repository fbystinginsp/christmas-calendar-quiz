import { ApiError, StoreError } from './errors.js';
import { speedPoints, estimateAccuracy } from './scoring.js';
import { parseSettings, normalizeQuestion, sortTotals } from './quiz.js';

const n = (v) => Number(v || 0);

// ---------- settings ----------
export const SETTING_DEFAULTS = {
  TIME_LIMIT_SECONDS: '30',
  GRACE_MS: '1500',
  CLOSE_DATE: '2026-12-31',
  REVEAL_AT_CLOSE: 'true',
  REVEAL_NOW: 'false',
  LATE_MULTIPLIER: '1',
  FEATURE_STREAK: 'false',
  FEATURE_OFFICE: 'false',
};

export function validateSettings(input = {}) {
  const bad = (m) => {
    throw new ApiError(400, 'invalid_settings', m);
  };
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(k in SETTING_DEFAULTS)) bad(`Unknown setting ${k}`);
    const s = String(v).trim();
    if (k === 'TIME_LIMIT_SECONDS') {
      const x = Number(s);
      if (!Number.isInteger(x) || x < 5 || x > 300) bad('Time limit must be 5-300 seconds');
    } else if (k === 'GRACE_MS') {
      const x = Number(s);
      if (!Number.isInteger(x) || x < 0 || x > 10000) bad('Grace must be 0-10000 ms');
    } else if (k === 'CLOSE_DATE') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad('Close date must be YYYY-MM-DD');
    } else if (k === 'LATE_MULTIPLIER') {
      const x = Number(s.replace(',', '.'));
      if (!Number.isFinite(x) || x < 0 || x > 1) bad('Late multiplier must be between 0 and 1');
      out[k] = String(x);
      continue;
    } else if (s !== 'true' && s !== 'false') bad(`${k} must be true or false`);
    out[k] = s;
  }
  return out;
}

export async function adminGetSettings(ctx) {
  const raw = await ctx.store.settings();
  return { values: Object.fromEntries(Object.keys(SETTING_DEFAULTS).map((k) => [k, raw[k] ?? SETTING_DEFAULTS[k]])) };
}

export async function adminSaveSettings(ctx, input) {
  const clean = validateSettings(input);
  for (const [k, v] of Object.entries(clean)) await ctx.store.saveSetting(k, v);
  return adminGetSettings(ctx);
}

// ---------- recalculate / re-score / delete ----------
async function updateTotalsRetry(ctx, rec, patch) {
  let cur = rec;
  for (let i = 0; i < 4; i++) {
    try {
      return await ctx.store.updateTotals(cur, patch);
    } catch (e) {
      if (!(e instanceof StoreError) || e.code !== 'conflict') throw e;
      cur = (await ctx.store.getTotals(rec.Title)) || cur;
    }
  }
  throw new ApiError(503, 'busy', 'Busy, try again');
}

// Rebuilds QuizTotals from QuizAttempts (the safety net). Only writes rows that differ.
export async function recalcTotals(ctx) {
  const [attempts, totals] = await Promise.all([ctx.store.allAttempts(), ctx.store.totalsAll()]);
  const byUser = new Map();
  for (const a of attempts.filter((x) => x.Status === 'answered')) {
    if (!byUser.has(a.UserId)) byUser.set(a.UserId, []);
    byUser.get(a.UserId).push(a);
  }
  const existing = new Map(totals.map((t) => [t.Title, t]));
  const jobs = [];
  let created = 0;
  let zeroed = 0;

  for (const [userId, rows] of byUser) {
    const correct = rows.filter((r) => r.IsCorrect);
    const latest = [...rows].sort((a, b) => String(b.AnsweredAt || '').localeCompare(String(a.AnsweredAt || '')))[0];
    const first = rows.map((r) => String(r.AnsweredAt || '')).filter(Boolean).sort()[0] || '';
    const agg = {
      DisplayName: latest.DisplayName,
      TotalPoints: rows.reduce((s, r) => s + n(r.Points), 0),
      CorrectCount: correct.length,
      AnsweredCount: rows.length,
      TotalCorrectTimeMs: correct.reduce((s, r) => s + n(r.ElapsedMs), 0),
      FirstAnswerAt: first,
    };
    const cur = existing.get(userId);
    if (!cur) {
      created++;
      jobs.push(() => ctx.store.createTotals({ Title: userId, ...agg }));
    } else if (Object.keys(agg).some((k) => (typeof agg[k] === 'number' ? n(cur[k]) !== agg[k] : String(cur[k] ?? '') !== agg[k]))) {
      jobs.push(() => updateTotalsRetry(ctx, cur, agg));
    }
  }
  for (const t of totals) {
    if (byUser.has(t.Title)) continue;
    if (n(t.TotalPoints) || n(t.AnsweredCount) || n(t.CorrectCount) || n(t.TotalCorrectTimeMs)) {
      zeroed++;
      jobs.push(() => updateTotalsRetry(ctx, t, { TotalPoints: 0, CorrectCount: 0, AnsweredCount: 0, TotalCorrectTimeMs: 0, FirstAnswerAt: '' }));
    }
  }
  for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map((j) => j()));
  return { users: byUser.size, written: jobs.length, created, zeroed };
}

// Re-evaluates every answered attempt of one question against the current key, then recalculates totals.
export async function rescoreQuestion(ctx, no) {
  const settings = parseSettings(await ctx.store.settings());
  const raw = (await ctx.store.questions()).find((x) => Number(x.QuestionNo) === Number(no));
  if (!raw) throw new ApiError(404, 'not_found', 'Question not found');
  const q = normalizeQuestion(raw);
  const attempts = (await ctx.store.attemptsForQuestion(no)).filter((a) => a.Status === 'answered');
  let changed = 0;
  for (const a of attempts) {
    let accuracy;
    if (q.type === 'mc') accuracy = a.AnswerValue === q.correctOptionId ? 1 : 0;
    else accuracy = estimateAccuracy(Number(a.AnswerValue), q.correctNumber, q.tolPct, q.zeroPct);
    const speed = speedPoints(n(a.ElapsedMs), settings.limitMs, q.basePoints);
    const late = a.LateMultiplier == null ? 1 : Number(a.LateMultiplier);
    const patch = { Accuracy: accuracy, IsCorrect: accuracy === 1, SpeedPoints: speed, Points: Math.round(speed * accuracy * late) };
    if (n(a.Points) !== patch.Points || !!a.IsCorrect !== patch.IsCorrect || n(a.Accuracy) !== patch.Accuracy || n(a.SpeedPoints) !== patch.SpeedPoints) {
      await ctx.store.updateAttempt(a, patch);
      changed++;
    }
  }
  const totals = await recalcTotals(ctx);
  return { checked: attempts.length, changed, totals };
}

// Nightly: stores each user's current rank and points, so "biggest mover" can compare against it.
export async function snapshotRanks(ctx) {
  const sorted = sortTotals(await ctx.store.totalsAll());
  const jobs = [];
  sorted.forEach((t, i) => {
    const rank = i + 1;
    const points = n(t.TotalPoints);
    if (n(t.RankSnapshot) !== rank || n(t.PointsSnapshot) !== points) {
      jobs.push(() => updateTotalsRetry(ctx, t, { RankSnapshot: rank, PointsSnapshot: points }));
    }
  });
  for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map((j) => j()));
  return { users: sorted.length, written: jobs.length };
}

export async function deleteAttempt(ctx, key) {
  const rec = await ctx.store.getAttempt(String(key || ''));
  if (!rec) throw new ApiError(404, 'not_found', 'Attempt not found');
  await ctx.store.deleteAttempt(rec);
  return { deleted: key, totals: await recalcTotals(ctx) };
}
