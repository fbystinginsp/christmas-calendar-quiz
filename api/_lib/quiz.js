import { ApiError, StoreError } from './errors.js';
import { osloDate } from './time.js';
import { speedPoints, estimateAccuracy, relativeErrorPct } from './scoring.js';
import { shuffleSeeded } from './shuffle.js';

// ctx = { store, now: Date, user: { id, displayName } }

const n = (v) => Number(v || 0);
const attemptKey = (userId, no) => `${userId}_${no}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseSettings(raw = {}) {
  const num = (k, d) => (raw[k] === undefined || raw[k] === '' || !Number.isFinite(Number(raw[k])) ? d : Number(raw[k]));
  const bool = (k, d) => (raw[k] === undefined ? d : String(raw[k]).toLowerCase() === 'true');
  return {
    limitMs: num('TIME_LIMIT_SECONDS', 30) * 1000,
    graceMs: num('GRACE_MS', 1500),
    closeDate: raw.CLOSE_DATE || '2026-12-31',
    revealAtClose: bool('REVEAL_AT_CLOSE', true),
    revealNow: bool('REVEAL_NOW', false),
    lateMultiplier: num('LATE_MULTIPLIER', 1),
  };
}

export function normalizeQuestion(r) {
  let options = [];
  try {
    options = JSON.parse(r.OptionsJson || '[]');
  } catch {
    options = [];
  }
  return {
    no: Number(r.QuestionNo),
    title: r.Title || '',
    unlockDate: r.UnlockDate || '',
    type: r.QuestionType || 'mc',
    category: r.Category || '',
    text: r.QuestionText || '',
    imagePath: r.ImagePath || '',
    options,
    correctOptionId: r.CorrectOptionId || '',
    correctNumber: r.CorrectNumber == null ? null : Number(r.CorrectNumber),
    unit: r.Unit || '',
    tolPct: r.TolerancePct == null ? 5 : Number(r.TolerancePct),
    zeroPct: r.ZeroPct == null ? 50 : Number(r.ZeroPct),
    basePoints: r.BasePoints == null ? 1000 : Number(r.BasePoints),
    explanation: r.Explanation || '',
  };
}

async function loadEnv(ctx) {
  const settings = parseSettings(await ctx.store.settings());
  const today = osloDate(ctx.now);
  const closed = today > settings.closeDate;
  const reveal = settings.revealNow || (settings.revealAtClose && closed);
  return { settings, today, closed, reveal };
}

async function loadQuestion(ctx, no) {
  const raw = (await ctx.store.questions()).find((q) => Number(q.QuestionNo) === Number(no));
  if (!raw) throw new ApiError(404, 'not_found', 'Question not found');
  return normalizeQuestion(raw);
}

function deadlineMs(attempt, settings) {
  return Date.parse(attempt.StartedAt) + settings.limitMs;
}

function statusOf(attempt, nowMs, settings) {
  if (!attempt) return 'available';
  if (attempt.Status === 'answered') return 'answered';
  if (attempt.Status === 'expired') return 'expired';
  return nowMs < deadlineMs(attempt, settings) ? 'in_progress' : 'expired';
}

function publicQuestion(q, userId) {
  const base = { no: q.no, type: q.type, category: q.category, text: q.text, unit: q.unit };
  if (q.type === 'mc') {
    base.options = shuffleSeeded(q.options, `${userId}:${q.no}`).map((o) => ({ id: o.id, text: o.text }));
  }
  return base;
}

function correctAnswerOf(q) {
  if (q.type === 'mc') {
    const o = q.options.find((x) => x.id === q.correctOptionId);
    return { optionId: q.correctOptionId, text: o ? o.text : '' };
  }
  return { number: q.correctNumber, unit: q.unit };
}

function resultFrom(a, q, reveal) {
  const answered = a.Status === 'answered';
  const guess = Number(a.AnswerValue);
  return {
    status: a.Status,
    isCorrect: !!a.IsCorrect,
    accuracy: n(a.Accuracy),
    points: n(a.Points),
    elapsedMs: n(a.ElapsedMs),
    onTheDay: !!a.OnTheDay,
    answerValue: a.AnswerValue ?? null,
    percentOff: answered && q.type === 'estimate' && Number.isFinite(guess) ? relativeErrorPct(guess, q.correctNumber) : null,
    correctAnswer: reveal ? correctAnswerOf(q) : null,
    explanation: reveal ? q.explanation : null,
  };
}

export function sortTotals(rows) {
  return [...rows].sort(
    (a, b) =>
      n(b.TotalPoints) - n(a.TotalPoints) ||
      n(a.TotalCorrectTimeMs) - n(b.TotalCorrectTimeMs) ||
      n(b.CorrectCount) - n(a.CorrectCount) ||
      String(a.FirstAnswerAt || '').localeCompare(String(b.FirstAnswerAt || '')),
  );
}

export function sortQuestionAttempts(rows) {
  return [...rows].sort((a, b) => n(b.Points) - n(a.Points) || n(a.ElapsedMs) - n(b.ElapsedMs));
}

// ---------- me ----------
export async function getMe(ctx, { isAdmin }) {
  const { today, closed } = await loadEnv(ctx);
  const [totals, qs, attempts] = await Promise.all([
    ctx.store.totalsAll(),
    ctx.store.questions(),
    ctx.store.attemptsForUser(ctx.user.id),
  ]);
  const sorted = sortTotals(totals);
  const idx = sorted.findIndex((t) => t.Title === ctx.user.id);
  const mine = idx >= 0 ? sorted[idx] : null;
  const unlocked = qs.map(normalizeQuestion).filter((q) => q.unlockDate <= today);
  const answeredNos = new Set(attempts.filter((a) => a.Status === 'answered' || a.Status === 'expired').map((a) => Number(a.QuestionNo)));
  return {
    id: ctx.user.id,
    displayName: ctx.user.displayName,
    isAdmin,
    closed,
    today,
    serverNow: ctx.now.toISOString(),
    totalPoints: mine ? n(mine.TotalPoints) : 0,
    correctCount: mine ? n(mine.CorrectCount) : 0,
    answeredCount: mine ? n(mine.AnsweredCount) : 0,
    rank: mine ? idx + 1 : null,
    participants: sorted.length,
    remaining: closed ? 0 : unlocked.filter((q) => !answeredNos.has(q.no)).length,
  };
}

// ---------- questions list ----------
export async function listQuestions(ctx) {
  const { settings, today, closed } = await loadEnv(ctx);
  const [qs, attempts] = await Promise.all([ctx.store.questions(), ctx.store.attemptsForUser(ctx.user.id)]);
  const byNo = new Map(attempts.map((a) => [Number(a.QuestionNo), a]));
  const nowMs = ctx.now.getTime();

  const questions = qs
    .map(normalizeQuestion)
    .sort((a, b) => a.no - b.no)
    .map((q) => {
      if (q.unlockDate > today) return { no: q.no, unlockDate: q.unlockDate, status: 'locked' };
      const a = byNo.get(q.no);
      let status = statusOf(a, nowMs, settings);
      if (closed && status === 'available') status = 'closed';
      return {
        no: q.no,
        unlockDate: q.unlockDate,
        category: q.category,
        type: q.type,
        status,
        points: a ? n(a.Points) : null,
        isCorrect: a ? !!a.IsCorrect : null,
        remainingMs: status === 'in_progress' ? Math.max(0, deadlineMs(a, settings) - nowMs) : null,
      };
    });
  return { serverNow: ctx.now.toISOString(), today, closed, questions };
}

// ---------- start ----------
export async function startQuestion(ctx, no) {
  const { settings, today, closed, reveal } = await loadEnv(ctx);
  const q = await loadQuestion(ctx, no);
  if (q.unlockDate > today) throw new ApiError(403, 'locked', 'Question is not unlocked yet');

  const key = attemptKey(ctx.user.id, q.no);
  let attempt = await ctx.store.getAttempt(key);

  if (!attempt) {
    if (closed) throw new ApiError(403, 'closed', 'The quiz is closed');
    try {
      attempt = await ctx.store.createAttempt({
        Title: key,
        UserId: ctx.user.id,
        DisplayName: ctx.user.displayName,
        QuestionNo: q.no,
        Status: 'started',
        StartedAt: ctx.now.toISOString(),
      });
    } catch (e) {
      if (!(e instanceof StoreError) || e.code !== 'exists') throw e;
      attempt = await ctx.store.getAttempt(key); // lost a race: resume the winner's attempt
    }
  }

  if (attempt.Status === 'answered' || attempt.Status === 'expired') {
    throw new ApiError(409, 'already_attempted', 'You have already played this question', { result: resultFrom(attempt, q, reveal) });
  }

  const deadline = deadlineMs(attempt, settings);
  if (ctx.now.getTime() >= deadline) {
    try {
      attempt = await ctx.store.updateAttempt(attempt, { Status: 'expired', Points: 0, IsCorrect: false, Accuracy: 0 });
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
    }
    throw new ApiError(409, 'already_attempted', 'Time ran out on this question', { result: resultFrom({ ...attempt, Status: 'expired' }, q, reveal) });
  }

  return {
    question: publicQuestion(q, ctx.user.id),
    startedAt: attempt.StartedAt,
    deadlineAt: new Date(deadline).toISOString(),
    serverNow: ctx.now.toISOString(),
    limitMs: settings.limitMs,
  };
}

// ---------- totals ----------
async function addToTotals(ctx, { points, correct, elapsedMs }) {
  for (let i = 0; i < 6; i++) {
    const t = await ctx.store.getTotals(ctx.user.id);
    try {
      if (!t) {
        return await ctx.store.createTotals({
          Title: ctx.user.id,
          DisplayName: ctx.user.displayName,
          TotalPoints: points,
          CorrectCount: correct ? 1 : 0,
          AnsweredCount: 1,
          TotalCorrectTimeMs: correct ? elapsedMs : 0,
          FirstAnswerAt: ctx.now.toISOString(),
        });
      }
      return await ctx.store.updateTotals(t, {
        DisplayName: ctx.user.displayName,
        TotalPoints: n(t.TotalPoints) + points,
        CorrectCount: n(t.CorrectCount) + (correct ? 1 : 0),
        AnsweredCount: n(t.AnsweredCount) + 1,
        TotalCorrectTimeMs: n(t.TotalCorrectTimeMs) + (correct ? elapsedMs : 0),
      });
    } catch (e) {
      if (e instanceof StoreError && (e.code === 'exists' || e.code === 'conflict')) {
        await sleep(30 + Math.random() * 70);
        continue;
      }
      throw e;
    }
  }
  throw new ApiError(503, 'busy', 'Busy, please try again');
}

// ---------- answer ----------
export async function answerQuestion(ctx, no, answer) {
  const { settings, today, reveal } = await loadEnv(ctx);
  const q = await loadQuestion(ctx, no);
  if (q.unlockDate > today) throw new ApiError(403, 'locked', 'Question is not unlocked yet');

  const attempt = await ctx.store.getAttempt(attemptKey(ctx.user.id, q.no));
  if (!attempt) throw new ApiError(409, 'not_started', 'Press Start first');
  if (attempt.Status !== 'started') {
    throw new ApiError(409, 'already_attempted', 'You have already played this question', { result: resultFrom(attempt, q, reveal) });
  }

  const elapsed = ctx.now.getTime() - Date.parse(attempt.StartedAt);
  if (elapsed > settings.limitMs + settings.graceMs) {
    const expired = await ctx.store.updateAttempt(attempt, { Status: 'expired', Points: 0, IsCorrect: false, Accuracy: 0 }).catch((e) => {
      if (e instanceof StoreError) return attempt;
      throw e;
    });
    return { ...resultFrom({ ...expired, Status: 'expired' }, q, reveal), expired: true, ...(await ranks(ctx, q.no)) };
  }

  // validate
  let accuracy;
  let answerValue;
  if (q.type === 'mc') {
    if (typeof answer !== 'string' || !q.options.some((o) => o.id === answer)) throw new ApiError(400, 'invalid_answer', 'Unknown option');
    answerValue = answer;
    accuracy = answer === q.correctOptionId ? 1 : 0;
  } else {
    const guess = typeof answer === 'string' ? Number(answer.replace(',', '.')) : answer;
    if (typeof guess !== 'number' || !Number.isFinite(guess)) throw new ApiError(400, 'invalid_answer', 'Enter a number');
    answerValue = String(guess);
    accuracy = estimateAccuracy(guess, q.correctNumber, q.tolPct, q.zeroPct);
  }

  const onTheDay = today === q.unlockDate;
  const lateMultiplier = onTheDay ? 1 : settings.lateMultiplier;
  const speed = speedPoints(elapsed, settings.limitMs, q.basePoints);
  const points = Math.round(speed * accuracy * lateMultiplier);
  const isCorrect = accuracy === 1;

  let saved;
  try {
    saved = await ctx.store.updateAttempt(attempt, {
      Status: 'answered',
      AnsweredAt: ctx.now.toISOString(),
      ElapsedMs: Math.round(elapsed),
      AnswerValue: answerValue,
      IsCorrect: isCorrect,
      Accuracy: accuracy,
      SpeedPoints: speed,
      LateMultiplier: lateMultiplier,
      Points: points,
      OnTheDay: onTheDay,
    });
  } catch (e) {
    if (e instanceof StoreError && e.code === 'conflict') {
      const stored = await ctx.store.getAttempt(attemptKey(ctx.user.id, q.no));
      throw new ApiError(409, 'already_attempted', 'You have already played this question', { result: resultFrom(stored, q, reveal) });
    }
    throw e;
  }

  const totals = await addToTotals(ctx, { points, correct: isCorrect, elapsedMs: Math.round(elapsed) });
  const rk = await ranks(ctx, q.no);
  return { ...resultFrom(saved, q, reveal), expired: false, totalPoints: n(totals.TotalPoints), ...rk };
}

async function ranks(ctx, no) {
  const [totals, attempts] = await Promise.all([ctx.store.totalsAll(), ctx.store.attemptsForQuestion(no)]);
  const t = sortTotals(totals).findIndex((r) => r.Title === ctx.user.id);
  const a = sortQuestionAttempts(attempts.filter((x) => x.Status === 'answered')).findIndex((r) => r.UserId === ctx.user.id);
  return { rankTotal: t >= 0 ? t + 1 : null, rankForQuestion: a >= 0 ? a + 1 : null };
}

// ---------- leaderboard ----------
function topWithMe(ranked, isMe, limit = 20) {
  const top = ranked.slice(0, limit);
  if (!top.some(isMe)) {
    const mine = ranked.find(isMe);
    if (mine) top.push(mine);
  }
  return top;
}

export async function getLeaderboard(ctx, { scope, no }) {
  if (scope === 'question') {
    const q = Number(no);
    const mine = await ctx.store.getAttempt(attemptKey(ctx.user.id, q));
    if (!mine || (mine.Status !== 'answered' && mine.Status !== 'expired')) {
      throw new ApiError(403, 'not_answered', 'Answer the question to see its leaderboard');
    }
    const rows = sortQuestionAttempts((await ctx.store.attemptsForQuestion(q)).filter((a) => a.Status === 'answered')).map((a, i) => ({
      rank: i + 1,
      displayName: a.DisplayName,
      points: n(a.Points),
      elapsedMs: n(a.ElapsedMs),
      isCorrect: !!a.IsCorrect,
      isMe: a.UserId === ctx.user.id,
    }));
    return { scope, no: q, rows: topWithMe(rows, (r) => r.isMe), participants: rows.length };
  }

  const rows = sortTotals(await ctx.store.totalsAll()).map((t, i) => ({
    rank: i + 1,
    displayName: t.DisplayName,
    totalPoints: n(t.TotalPoints),
    correctCount: n(t.CorrectCount),
    answeredCount: n(t.AnsweredCount),
    avgCorrectMs: n(t.CorrectCount) ? Math.round(n(t.TotalCorrectTimeMs) / n(t.CorrectCount)) : null,
    isMe: t.Title === ctx.user.id,
  }));
  return { scope: 'total', rows: topWithMe(rows, (r) => r.isMe), participants: rows.length };
}

// ---------- admin: questions ----------
export function validateQuestionInput(b) {
  const bad = (m) => {
    throw new ApiError(400, 'invalid_question', m);
  };
  const no = Number(b.no);
  if (!Number.isInteger(no) || no < 1 || no > 24) bad('Question number must be 1-24');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.unlockDate || ''))) bad('Unlock date must be YYYY-MM-DD');
  if (!['mc', 'estimate'].includes(b.type)) bad('Type must be mc or estimate');
  if (!String(b.text || '').trim()) bad('Question text is required');

  const fields = {
    Title: String(b.title || `Dag ${no}`).slice(0, 200),
    QuestionNo: no,
    UnlockDate: b.unlockDate,
    QuestionType: b.type,
    QuestionText: String(b.text),
    Explanation: String(b.explanation || ''),
    ImagePath: String(b.imagePath || ''),
    Unit: String(b.unit || ''),
    TolerancePct: b.tolPct === '' || b.tolPct == null ? 5 : Number(b.tolPct),
    ZeroPct: b.zeroPct === '' || b.zeroPct == null ? 50 : Number(b.zeroPct),
    BasePoints: b.basePoints === '' || b.basePoints == null ? 1000 : Number(b.basePoints),
  };
  if (b.category) fields.Category = b.category;

  if (b.type === 'mc') {
    const options = Array.isArray(b.options) ? b.options.filter((o) => o && String(o.text || '').trim()) : [];
    if (options.length < 2 || options.length > 5) bad('Multiple choice needs 2-5 options');
    const ids = new Set(options.map((o) => o.id));
    if (ids.size !== options.length) bad('Option ids must be unique');
    if (!ids.has(b.correctOptionId)) bad('Pick the correct option');
    fields.OptionsJson = JSON.stringify(options.map((o) => ({ id: String(o.id), text: String(o.text) })));
    fields.CorrectOptionId = b.correctOptionId;
  } else {
    const cn = Number(b.correctNumber);
    if (b.correctNumber === '' || b.correctNumber == null || !Number.isFinite(cn)) bad('Correct number is required');
    fields.CorrectNumber = cn;
  }
  if (!(fields.TolerancePct >= 0 && fields.ZeroPct > fields.TolerancePct)) bad('Zero % must be greater than tolerance %');
  return fields;
}

export async function adminListQuestions(ctx) {
  return { questions: (await ctx.store.questions()).map(normalizeQuestion).sort((a, b) => a.no - b.no) };
}

// ---------- admin: results ----------
export async function adminResults(ctx) {
  const [rawQs, attempts, totals] = await Promise.all([ctx.store.questions(), ctx.store.allAttempts(), ctx.store.totalsAll()]);
  const questions = rawQs.map(normalizeQuestion).sort((a, b) => a.no - b.no);
  const qByNo = new Map(questions.map((q) => [q.no, q]));

  const answerText = (a) => {
    const q = qByNo.get(Number(a.QuestionNo));
    if (a.AnswerValue == null || a.AnswerValue === '') return '';
    if (q?.type === 'mc') return q.options.find((o) => o.id === a.AnswerValue)?.text ?? a.AnswerValue;
    return `${a.AnswerValue}${q?.unit ? ` ${q.unit}` : ''}`;
  };

  const participants = sortTotals(totals).map((t, i) => ({
    rank: i + 1,
    displayName: t.DisplayName,
    totalPoints: n(t.TotalPoints),
    correctCount: n(t.CorrectCount),
    answeredCount: n(t.AnsweredCount),
    avgCorrectMs: n(t.CorrectCount) ? Math.round(n(t.TotalCorrectTimeMs) / n(t.CorrectCount)) : null,
  }));

  const perQuestion = questions.map((q) => {
    const rows = attempts.filter((a) => Number(a.QuestionNo) === q.no);
    const answered = rows.filter((a) => a.Status === 'answered');
    const correct = answered.filter((a) => a.IsCorrect);
    const wrong = {};
    for (const a of answered.filter((x) => !x.IsCorrect)) {
      const label = answerText(a);
      wrong[label] = (wrong[label] || 0) + 1;
    }
    const topWrong = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
    return {
      no: q.no,
      title: q.title,
      type: q.type,
      unlockDate: q.unlockDate,
      correctAnswer: q.type === 'mc' ? q.options.find((o) => o.id === q.correctOptionId)?.text ?? '' : `${q.correctNumber ?? ''}${q.unit ? ` ${q.unit}` : ''}`,
      answered: answered.length,
      expired: rows.filter((a) => a.Status === 'expired').length,
      inProgress: rows.filter((a) => a.Status === 'started').length,
      correct: correct.length,
      correctPct: answered.length ? Math.round((correct.length / answered.length) * 100) : null,
      avgPoints: answered.length ? Math.round(answered.reduce((s, a) => s + n(a.Points), 0) / answered.length) : null,
      avgElapsedMs: answered.length ? Math.round(answered.reduce((s, a) => s + n(a.ElapsedMs), 0) / answered.length) : null,
      topWrong: topWrong ? { answer: topWrong[0], count: topWrong[1] } : null,
    };
  });

  const rows = [...attempts]
    .sort((a, b) => String(b.StartedAt || '').localeCompare(String(a.StartedAt || '')))
    .map((a) => ({
      displayName: a.DisplayName,
      no: Number(a.QuestionNo),
      status: a.Status,
      answer: answerText(a),
      isCorrect: !!a.IsCorrect,
      points: n(a.Points),
      elapsedMs: a.ElapsedMs == null ? null : n(a.ElapsedMs),
      onTheDay: !!a.OnTheDay,
      startedAt: a.StartedAt || '',
    }));

  return {
    summary: {
      participants: participants.length,
      attempts: attempts.length,
      answered: attempts.filter((a) => a.Status === 'answered').length,
      expired: attempts.filter((a) => a.Status === 'expired').length,
      inProgress: attempts.filter((a) => a.Status === 'started').length,
    },
    participants,
    perQuestion,
    attempts: rows,
  };
}
