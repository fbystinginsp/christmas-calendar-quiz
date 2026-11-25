import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../api/_lib/store/memory.js';
import { startQuestion, answerQuestion, getReview, getLeaderboard, assignBadges } from '../api/_lib/quiz.js';
import { snapshotRanks } from '../api/_lib/maintenance.js';
import { tokenTenant } from '../api/_lib/auth.js';

const q = (no, date, extra = {}) => ({
  QuestionNo: no,
  Title: `Dag ${no}`,
  UnlockDate: date,
  QuestionType: 'mc',
  QuestionText: `Spørsmål ${no}?`,
  OptionsJson: JSON.stringify([
    { id: 'a', text: 'Alfa' },
    { id: 'b', text: 'Bravo' },
  ]),
  CorrectOptionId: 'b',
  Explanation: 'Fordi bravo.',
  ...extra,
});
const user = (id) => ({ id, displayName: `User ${id}` });
const T0 = Date.parse('2026-12-05T08:00:00Z');
const at = (ms) => new Date(T0 + ms);
const mk = () => createMemoryStore({ questions: [q(1, '2026-12-01'), q(2, '2026-12-02'), q(3, '2026-12-03', { QuestionType: 'estimate', OptionsJson: '', CorrectOptionId: '', CorrectNumber: 100, Unit: 'stk' })] });

async function play(store, id, no, answer, ms, startMs = 0) {
  await startQuestion({ store, user: user(id), now: at(startMs) }, no);
  return answerQuestion({ store, user: user(id), now: at(startMs + ms) }, no, answer);
}

test('review lists my answers with text; correct answer hidden until reveal', async () => {
  const store = mk();
  await play(store, 'u', 1, 'a', 1000);
  await play(store, 'u', 3, '104', 2000, 10000);
  const r = await getReview({ store, user: user('u'), now: at(60000) });
  assert.equal(r.reveal, false);
  assert.deepEqual(r.items.map((i) => [i.no, i.yourAnswer, i.isCorrect]), [[1, 'Alfa', false], [3, '104 stk', true]]);
  assert.ok(r.items.every((i) => i.correctAnswer === null && i.explanation === null));

  const after = await getReview({ store, user: user('u'), now: new Date('2027-01-02T10:00:00Z') });
  assert.equal(after.reveal, true);
  assert.equal(after.items[0].correctAnswer.text, 'Bravo');
  assert.equal(after.items[0].explanation, 'Fordi bravo.');
});

test('review only contains my own attempts', async () => {
  const store = mk();
  await play(store, 'a', 1, 'b', 1000);
  await play(store, 'b', 2, 'b', 1000);
  const r = await getReview({ store, user: user('a'), now: at(60000) });
  assert.deepEqual(r.items.map((i) => i.no), [1]);
});

test('answers after the close date are rejected', async () => {
  const store = mk();
  await startQuestion({ store, user: user('u'), now: new Date('2026-12-31T22:00:00Z') }, 1); // 23:00 Oslo on the 31st
  await assert.rejects(answerQuestion({ store, user: user('u'), now: new Date('2026-12-31T23:30:00Z') }, 1, 'b'), { code: 'closed' }); // 00:30 on 1 Jan
});

test('estimate input tolerates spaces and decimal comma', async () => {
  const store = mk();
  await startQuestion({ store, user: user('u'), now: at(0) }, 3);
  const r = await answerQuestion({ store, user: user('u'), now: at(1000) }, 3, ' 1 0 0,5 ');
  assert.equal(r.isCorrect, true);
});

// ---------- badges ----------
const row = (rank, o = {}) => ({ rank, totalPoints: 100 - rank, correctCount: 5, avgCorrectMs: 10000, rankChange: 0, ...o });

test('badges: leader, biggest mover (ties -> better rank), fastest average (min 3 correct)', () => {
  const rows = assignBadges([
    row(1),
    row(2, { rankChange: 3 }),
    row(3, { rankChange: 3, avgCorrectMs: 4000 }),
    row(4, { rankChange: -2 }),
    row(5, { correctCount: 2, avgCorrectMs: 1000 }), // too few correct for the fast badge
  ]);
  assert.deepEqual(rows.map((r) => r.badges), [['leader'], ['mover'], ['fast'], [], []]);
});

test('badges: nobody is leader at 0 points; no mover without improvement; no wooden spoon', () => {
  const rows = assignBadges([row(1, { totalPoints: 0, correctCount: 0, avgCorrectMs: null }), row(2, { totalPoints: 0, correctCount: 0, avgCorrectMs: null, rankChange: null })]);
  assert.deepEqual(rows.map((r) => r.badges), [[], []]);
  const last = assignBadges([row(1), row(2), row(3)]).at(-1);
  assert.ok(!last.badges.includes('spoon'));
});

test('snapshot stores rank and points, leaderboard then shows rank change', async () => {
  const store = mk();
  await play(store, 'a', 1, 'b', 1000); // a: 983 points ahead
  await play(store, 'b', 1, 'a', 1000); // b: 0
  const ctx = { store, user: user('admin'), now: at(120000) };
  const s1 = await snapshotRanks(ctx);
  assert.equal(s1.users, 2);
  assert.equal(s1.written, 2);
  assert.equal((await snapshotRanks(ctx)).written, 0); // idempotent

  // b overtakes a the next day
  await play(store, 'b', 2, 'b', 1000, 200000);
  await play(store, 'b', 3, '100', 1000, 300000);
  const lb = await getLeaderboard({ store, user: user('b'), now: at(400000) }, { scope: 'total' });
  const b = lb.rows.find((r) => r.isMe);
  assert.equal(b.rank, 1);
  assert.equal(b.rankChange, 1);
  assert.deepEqual(b.badges.sort(), ['leader', 'mover']);
});

// ---------- tenant check ----------
test('tokenTenant reads tid from a JWT and returns null for opaque tokens', () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(tokenTenant(`${enc({ alg: 'RS256' })}.${enc({ tid: 'tenant-1' })}.sig`), 'tenant-1');
  assert.equal(tokenTenant('opaque-token-without-dots'), null);
  assert.equal(tokenTenant(''), null);
});
