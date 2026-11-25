import test from 'node:test';
import assert from 'node:assert/strict';
import { speedPoints, estimateAccuracy } from '../api/_lib/scoring.js';
import { shuffleSeeded } from '../api/_lib/shuffle.js';
import { osloDate } from '../api/_lib/time.js';
import { createMemoryStore } from '../api/_lib/store/memory.js';
import { startQuestion, answerQuestion, listQuestions, getLeaderboard, getMe, sortTotals, validateQuestionInput } from '../api/_lib/quiz.js';

// ---------- scoring ----------
test('speedPoints: 1000 at 0s, 750 at 15s, 500 at limit, clamped beyond', () => {
  assert.equal(speedPoints(0, 30000), 1000);
  assert.equal(speedPoints(15000, 30000), 750);
  assert.equal(speedPoints(30000, 30000), 500);
  assert.equal(speedPoints(31500, 30000), 500);
});

test('estimateAccuracy: full within tolerance, tapers, zero at 50%', () => {
  assert.equal(estimateAccuracy(100, 100), 1);
  assert.equal(estimateAccuracy(105, 100), 1);
  assert.equal(estimateAccuracy(150, 100), 0);
  assert.equal(estimateAccuracy(200, 100), 0);
  const mid = estimateAccuracy(127.5, 100); // 27.5% error, halfway between 5 and 50
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
});

// ---------- shuffle ----------
test('shuffleSeeded is deterministic per seed and differs between seeds', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(shuffleSeeded(arr, 'u1:5'), shuffleSeeded(arr, 'u1:5'));
  assert.deepEqual([...shuffleSeeded(arr, 'u1:5')].sort(), arr);
  const orders = new Set(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((u) => shuffleSeeded(arr, `${u}:5`).join('')));
  assert.ok(orders.size > 1);
});

// ---------- dates ----------
test('osloDate gives YYYY-MM-DD in Europe/Oslo', () => {
  assert.equal(osloDate(new Date('2026-12-05T22:30:00Z')), '2026-12-05'); // 23:30 Oslo
  assert.equal(osloDate(new Date('2026-12-05T23:00:00Z')), '2026-12-06'); // 00:00 Oslo
});

// ---------- quiz flow ----------
const q = (no, date, extra = {}) => ({
  QuestionNo: no,
  Title: `Dag ${no}`,
  UnlockDate: date,
  QuestionType: 'mc',
  QuestionText: `Spørsmål ${no}?`,
  OptionsJson: JSON.stringify([
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
    { id: 'd', text: 'D' },
  ]),
  CorrectOptionId: 'b',
  Explanation: 'Fordi.',
  ...extra,
});

const mkStore = () =>
  createMemoryStore({
    settings: { TIME_LIMIT_SECONDS: '30', GRACE_MS: '1500', CLOSE_DATE: '2026-12-31', LATE_MULTIPLIER: '1.0' },
    questions: [
      q(1, '2026-12-01'),
      q(2, '2026-12-02'),
      q(5, '2026-12-05'),
      q(6, '2026-12-06', { QuestionType: 'estimate', OptionsJson: '', CorrectOptionId: '', CorrectNumber: 100, TolerancePct: 5, ZeroPct: 50 }),
    ],
  });

const at = (iso) => new Date(iso);
const user = (id) => ({ id, displayName: `User ${id}` });
const ctx = (store, id, iso) => ({ store, user: user(id), now: at(iso) });

test('locked questions cannot be started and are listed without detail', async () => {
  const store = mkStore();
  const list = await listQuestions(ctx(store, 'u1', '2026-12-02T10:00:00Z'));
  assert.deepEqual(list.questions.map((x) => [x.no, x.status]), [[1, 'available'], [2, 'available'], [5, 'locked'], [6, 'locked']]);
  await assert.rejects(startQuestion(ctx(store, 'u1', '2026-12-02T10:00:00Z'), 5), { code: 'locked', status: 403 });
});

test('new user on day 20 can play any earlier question', async () => {
  const store = mkStore();
  const c = ctx(store, 'late', '2026-12-20T10:00:00Z');
  const list = await listQuestions(c);
  assert.ok(list.questions.every((x) => x.status === 'available'));
  const s = await startQuestion(c, 1);
  assert.equal(s.question.no, 1);
});

test('start never leaks the correct answer; options shuffled per user, stable per user', async () => {
  const store = mkStore();
  const a1 = await startQuestion(ctx(store, 'u1', '2026-12-05T08:00:00Z'), 5);
  assert.ok(!JSON.stringify(a1).includes('correctOptionId'));
  assert.ok(!JSON.stringify(a1).includes('Fordi'));
  const a2 = await startQuestion(ctx(store, 'u1', '2026-12-05T08:00:10Z'), 5); // resume
  assert.deepEqual(a1.question.options, a2.question.options);
  assert.equal(a1.startedAt, a2.startedAt);
});

test('answer at 0s ~1000, at 15s 750, at 30s 500, after limit+grace 0', async () => {
  const cases = [
    [0, 1000],
    [15000, 750],
    [30000, 500],
  ];
  for (const [ms, expected] of cases) {
    const store = mkStore();
    const t0 = Date.parse('2026-12-05T08:00:00Z');
    await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
    const r = await answerQuestion({ store, user: user('u'), now: new Date(t0 + ms) }, 5, 'b');
    assert.equal(r.points, expected);
    assert.equal(r.isCorrect, true);
  }
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const r = await answerQuestion({ store, user: user('u'), now: new Date(t0 + 31600) }, 5, 'b');
  assert.equal(r.points, 0);
  assert.equal(r.expired, true);
});

test('within grace window still scores, capped at 500', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const r = await answerQuestion({ store, user: user('u'), now: new Date(t0 + 31000) }, 5, 'b');
  assert.equal(r.points, 500);
});

test('wrong answer scores 0 and still counts as answered', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const r = await answerQuestion({ store, user: user('u'), now: new Date(t0 + 2000) }, 5, 'a');
  assert.equal(r.points, 0);
  assert.equal(r.isCorrect, false);
  const me = await getMe({ store, user: user('u'), now: new Date(t0 + 3000) }, { isAdmin: false });
  assert.equal(me.answeredCount, 1);
  assert.equal(me.correctCount, 0);
});

test('one attempt only: second answer and re-start both return 409 already_attempted', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  const c = (ms) => ({ store, user: user('u'), now: new Date(t0 + ms) });
  await startQuestion(c(0), 5);
  await answerQuestion(c(1000), 5, 'b');
  await assert.rejects(answerQuestion(c(2000), 5, 'b'), { code: 'already_attempted', status: 409 });
  await assert.rejects(startQuestion(c(3000), 5), { code: 'already_attempted', status: 409 });
  const me = await getMe(c(4000), { isAdmin: false });
  assert.equal(me.answeredCount, 1); // never double counted
});

test('double submit in parallel scores exactly once', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const c = { store, user: user('u'), now: new Date(t0 + 1000) };
  const res = await Promise.allSettled([answerQuestion(c, 5, 'b'), answerQuestion(c, 5, 'b'), answerQuestion(c, 5, 'b')]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  const me = await getMe({ ...c, now: new Date(t0 + 2000) }, { isAdmin: false });
  assert.equal(me.answeredCount, 1);
});

test('parallel starts create a single attempt', async () => {
  const store = mkStore();
  const c = ctx(store, 'u', '2026-12-05T08:00:00Z');
  const res = await Promise.all([startQuestion(c, 5), startQuestion(c, 5), startQuestion(c, 5)]);
  assert.equal(new Set(res.map((r) => r.startedAt)).size, 1);
  assert.equal(store._data.attempts.length, 1);
});

test('parallel answers to different questions do not lose points', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 1);
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 2);
  const c = { store, user: user('u'), now: new Date(t0) };
  await Promise.all([answerQuestion(c, 1, 'b'), answerQuestion(c, 2, 'b')]);
  const me = await getMe({ ...c, now: new Date(t0 + 1000) }, { isAdmin: false });
  assert.equal(me.totalPoints, 2000);
  assert.equal(me.answeredCount, 2);
});

test('late play flagged and multiplier applied', async () => {
  const store = mkStore();
  await store.saveSetting('LATE_MULTIPLIER', '0.5');
  const t0 = Date.parse('2026-12-10T08:00:00Z'); // question 5 unlocked on the 5th
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const r = await answerQuestion({ store, user: user('u'), now: new Date(t0) }, 5, 'b');
  assert.equal(r.onTheDay, false);
  assert.equal(r.points, 500);
});

test('estimate scoring and invalid input', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-06T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 6);
  await assert.rejects(answerQuestion({ store, user: user('u'), now: new Date(t0 + 1000) }, 6, 'abc'), { code: 'invalid_answer' });
  const r = await answerQuestion({ store, user: user('u'), now: new Date(t0) }, 6, 104);
  assert.equal(r.isCorrect, true);
  assert.equal(r.points, 1000);
  assert.equal(r.percentOff, 4);
});

test('mc answer must be a known option id', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  await assert.rejects(answerQuestion({ store, user: user('u'), now: new Date(t0 + 1000) }, 5, 'zzz'), { code: 'invalid_answer' });
});

test('correct answer and explanation held back until close date', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const r = await answerQuestion({ store, user: user('u'), now: new Date(t0 + 1000) }, 5, 'a');
  assert.equal(r.correctAnswer, null);
  assert.equal(r.explanation, null);
  // after close: replay of the stored result reveals the key
  await assert.rejects(startQuestion({ store, user: user('u'), now: new Date('2027-01-02T10:00:00Z') }, 5), (e) => {
    assert.equal(e.code, 'already_attempted');
    assert.equal(e.details.result.correctAnswer.optionId, 'b');
    return true;
  });
});

test('closed quiz rejects new starts but keeps leaderboards', async () => {
  const store = mkStore();
  await assert.rejects(startQuestion(ctx(store, 'u', '2027-01-02T10:00:00Z'), 1), { code: 'closed' });
});

test('expired attempt: reload after deadline gives 0 points and is not replayable', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  await assert.rejects(startQuestion({ store, user: user('u'), now: new Date(t0 + 40000) }, 5), { code: 'already_attempted' });
  const list = await listQuestions({ store, user: user('u'), now: new Date(t0 + 41000) });
  assert.equal(list.questions.find((x) => x.no === 5).status, 'expired');
});

test('resume returns remaining time, deadline unchanged', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  const a = await startQuestion({ store, user: user('u'), now: new Date(t0) }, 5);
  const b = await startQuestion({ store, user: user('u'), now: new Date(t0 + 12000) }, 5);
  assert.equal(a.deadlineAt, b.deadlineAt);
  const list = await listQuestions({ store, user: user('u'), now: new Date(t0 + 12000) });
  assert.equal(list.questions.find((x) => x.no === 5).remainingMs, 18000);
});

// ---------- leaderboards ----------
test('total leaderboard order and tie-breakers', () => {
  const rows = [
    { Title: 'a', TotalPoints: 1000, TotalCorrectTimeMs: 9000, CorrectCount: 2, FirstAnswerAt: '2026-12-02' },
    { Title: 'b', TotalPoints: 1000, TotalCorrectTimeMs: 5000, CorrectCount: 1, FirstAnswerAt: '2026-12-03' },
    { Title: 'c', TotalPoints: 1000, TotalCorrectTimeMs: 5000, CorrectCount: 2, FirstAnswerAt: '2026-12-04' },
    { Title: 'd', TotalPoints: 1000, TotalCorrectTimeMs: 5000, CorrectCount: 2, FirstAnswerAt: '2026-12-01' },
    { Title: 'e', TotalPoints: 2000, TotalCorrectTimeMs: 99999, CorrectCount: 1, FirstAnswerAt: '2026-12-09' },
  ];
  assert.deepEqual(sortTotals(rows).map((r) => r.Title), ['e', 'd', 'c', 'b', 'a']);
});

test('question leaderboard hidden until the user has answered it', async () => {
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  await startQuestion({ store, user: user('a'), now: new Date(t0) }, 5);
  await answerQuestion({ store, user: user('a'), now: new Date(t0 + 3000) }, 5, 'b');
  await assert.rejects(getLeaderboard({ store, user: user('b'), now: new Date(t0) }, { scope: 'question', no: 5 }), { code: 'not_answered' });
  await startQuestion({ store, user: user('b'), now: new Date(t0) }, 5);
  await answerQuestion({ store, user: user('b'), now: new Date(t0 + 1000) }, 5, 'b');
  const lb = await getLeaderboard({ store, user: user('b'), now: new Date(t0) }, { scope: 'question', no: 5 });
  assert.deepEqual(lb.rows.map((r) => [r.rank, r.isMe]), [[1, true], [2, false]]);
  assert.ok(lb.rows.every((r) => !('Title' in r) && !('userId' in r) && !('UserId' in r)));
});

test('total leaderboard shows top 20 plus the caller when outside it', async () => {
  const store = mkStore();
  for (let i = 0; i < 25; i++) {
    await store.createTotals({ Title: `p${i}`, DisplayName: `P${i}`, TotalPoints: 1000 - i, CorrectCount: 1, AnsweredCount: 1, TotalCorrectTimeMs: 1000, FirstAnswerAt: '2026-12-01' });
  }
  const lb = await getLeaderboard({ store, user: user('p24'), now: new Date('2026-12-05T10:00:00Z') }, { scope: 'total' });
  assert.equal(lb.rows.length, 21);
  assert.equal(lb.rows.at(-1).rank, 25);
  assert.equal(lb.rows.at(-1).isMe, true);
  assert.ok(lb.rows.every((r) => !('Title' in r) && !('userId' in r)));
});

// ---------- admin validation ----------
test('validateQuestionInput maps to SharePoint field names and rejects bad input', () => {
  const ok = validateQuestionInput({
    no: 3, unlockDate: '2026-12-03', type: 'mc', text: 'Hva?', category: 'Jul',
    options: [{ id: 'a', text: 'X' }, { id: 'b', text: 'Y' }], correctOptionId: 'b',
  });
  assert.equal(ok.QuestionType, 'mc');
  assert.equal(ok.CorrectOptionId, 'b');
  assert.equal(ok.QuestionNo, 3);
  assert.throws(() => validateQuestionInput({ no: 30, unlockDate: '2026-12-03', type: 'mc', text: 'x' }), { code: 'invalid_question' });
  assert.throws(() => validateQuestionInput({ no: 3, unlockDate: '2026-12-03', type: 'mc', text: 'x', options: [{ id: 'a', text: 'X' }], correctOptionId: 'a' }), { code: 'invalid_question' });
  assert.throws(() => validateQuestionInput({ no: 3, unlockDate: '2026-12-03', type: 'estimate', text: 'x' }), { code: 'invalid_question' });
});

// ---------- admin results ----------
test('adminResults aggregates participants, per-question stats and attempts', async () => {
  const { adminResults } = await import('../api/_lib/quiz.js');
  const store = mkStore();
  const t0 = Date.parse('2026-12-05T08:00:00Z');
  for (const [id, ans, ms] of [['a', 'b', 1000], ['b', 'a', 2000], ['c', 'a', 3000]]) {
    await startQuestion({ store, user: user(id), now: new Date(t0) }, 5);
    await answerQuestion({ store, user: user(id), now: new Date(t0 + ms) }, 5, ans);
  }
  await startQuestion({ store, user: user('d'), now: new Date(t0) }, 5); // left in progress
  const r = await adminResults({ store, user: user('admin'), now: new Date(t0 + 5000) });
  assert.equal(r.summary.participants, 3);
  assert.equal(r.summary.answered, 3);
  assert.equal(r.summary.inProgress, 1);
  const q5 = r.perQuestion.find((x) => x.no === 5);
  assert.equal(q5.correct, 1);
  assert.equal(q5.correctPct, 33);
  assert.equal(q5.correctAnswer, 'B');
  assert.deepEqual(q5.topWrong, { answer: 'A', count: 2 });
  assert.equal(r.participants[0].displayName, 'User a');
  assert.equal(r.attempts.length, 4);
  assert.equal(r.attempts.find((x) => x.displayName === 'User b').answer, 'A');
});

// ---------- images ----------
test('safeImageName accepts plain file names only', async () => {
  const { safeImageName } = await import('../api/_lib/quiz.js');
  assert.equal(safeImageName('q05.jpg'), 'q05.jpg');
  assert.equal(safeImageName('/img/q05.PNG'), 'q05.PNG');
  assert.equal(safeImageName(String.raw`..\..\secret.jpg`), 'secret.jpg');
  assert.equal(safeImageName('../../etc/passwd'), '');
  assert.equal(safeImageName('q05.exe'), '');
  assert.equal(safeImageName(''), '');
  assert.equal(safeImageName('a b.jpg'), '');
});

test('image route logic: gated by unlock, 404 without image, never exposes the file name in start', async () => {
  const { getQuestionImage } = await import('../api/_lib/quiz.js');
  const store = createMemoryStore({
    questions: [q(1, '2026-12-01', { ImagePath: 'q01.jpg' }), q(2, '2026-12-20', { ImagePath: 'q02.jpg' }), q(3, '2026-12-01')],
    images: { 'q01.jpg': { buffer: Buffer.from('x'), contentType: 'image/jpeg' } },
  });
  const c = ctx(store, 'u', '2026-12-05T10:00:00Z');
  const img = await getQuestionImage(c, 1);
  assert.equal(img.raw.contentType, 'image/jpeg');
  await assert.rejects(getQuestionImage(c, 2), { code: 'locked', status: 403 });
  await assert.rejects(getQuestionImage(c, 3), { code: 'no_image', status: 404 });
  const s = await startQuestion(c, 1);
  assert.equal(s.question.hasImage, true);
  assert.ok(!JSON.stringify(s).includes('q01.jpg'));
  const list = await listQuestions(c);
  assert.equal(list.questions.find((x) => x.no === 1).hasImage, true);
  assert.ok(!JSON.stringify(list).includes('q01.jpg'));
});

test('admin validation rejects a bad image name', () => {
  assert.throws(() => validateQuestionInput({ no: 3, unlockDate: '2026-12-03', type: 'estimate', text: 'x', correctNumber: 5, imagePath: 'virus.exe' }), { code: 'invalid_question' });
  assert.equal(validateQuestionInput({ no: 3, unlockDate: '2026-12-03', type: 'estimate', text: 'x', correctNumber: 5, imagePath: 'q03.jpg' }).ImagePath, 'q03.jpg');
});
