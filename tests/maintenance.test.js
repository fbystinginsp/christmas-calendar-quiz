import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../api/_lib/store/memory.js';
import { startQuestion, answerQuestion, getMe, sortTotals } from '../api/_lib/quiz.js';
import { recalcTotals, rescoreQuestion, deleteAttempt, validateSettings, adminGetSettings, adminSaveSettings } from '../api/_lib/maintenance.js';

const q = (no, date, extra = {}) => ({
  QuestionNo: no,
  Title: `Dag ${no}`,
  UnlockDate: date,
  QuestionType: 'mc',
  QuestionText: `Spørsmål ${no}?`,
  OptionsJson: JSON.stringify([
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ]),
  CorrectOptionId: 'b',
  ...extra,
});
const mkStore = () => createMemoryStore({ questions: [q(1, '2026-12-01'), q(2, '2026-12-02'), q(3, '2026-12-03', { QuestionType: 'estimate', OptionsJson: '', CorrectOptionId: '', CorrectNumber: 100 })] });
const user = (id) => ({ id, displayName: `User ${id}` });
const T0 = Date.parse('2026-12-05T08:00:00Z');
const at = (ms) => new Date(T0 + ms);

async function play(store, id, no, answer, ms) {
  await startQuestion({ store, user: user(id), now: at(0) }, no);
  return answerQuestion({ store, user: user(id), now: at(ms) }, no, answer);
}

async function seed(store) {
  await play(store, 'u1', 1, 'b', 2000);
  await play(store, 'u1', 2, 'a', 4000);
  await play(store, 'u1', 3, 120, 6000);
  await play(store, 'u2', 3, 100, 3000); // time must move forward per user, as in real life
  await play(store, 'u2', 1, 'b', 9000);
}
const snapshot = (rows) =>
  sortTotals(rows).map((r) => [r.Title, r.TotalPoints, r.CorrectCount, r.AnsweredCount, r.TotalCorrectTimeMs]);
const ctx = (store) => ({ store, user: user('admin'), now: at(60000) });

test('recalc gives identical totals to incremental play, and is idempotent', async () => {
  const store = mkStore();
  await seed(store);
  const before = snapshot(await store.totalsAll());
  const r1 = await recalcTotals(ctx(store));
  assert.equal(r1.written, 0); // already consistent -> nothing to write
  assert.deepEqual(snapshot(await store.totalsAll()), before);
});

test('recalc repairs corrupted and missing totals rows', async () => {
  const store = mkStore();
  await seed(store);
  const before = snapshot(await store.totalsAll());
  const row = store._data.totals.find((t) => t.Title === 'u1');
  row.TotalPoints = 1; // corrupt
  store._data.totals = store._data.totals.filter((t) => t.Title !== 'u2'); // lose a row
  const r = await recalcTotals(ctx(store));
  assert.equal(r.created, 1);
  assert.deepEqual(snapshot(await store.totalsAll()), before);
});

test('rescore after fixing a wrong answer key changes points and totals', async () => {
  const store = mkStore();
  await seed(store); // key for Q1 is B; u1 and u2 both answered B (correct)
  const pts = async (id) => (await getMe({ store, user: user(id), now: at(70000) }, { isAdmin: false })).totalPoints;
  const u1Before = await pts('u1');
  // admin discovers the real key is A
  await store.saveQuestion({ QuestionNo: 1, CorrectOptionId: 'a' });
  const r = await rescoreQuestion(ctx(store), 1);
  assert.equal(r.checked, 2);
  assert.equal(r.changed, 2);
  assert.ok((await pts('u1')) < u1Before);
  const a = store._data.attempts.find((x) => x.Title === 'u1_1');
  assert.equal(a.IsCorrect, false);
  assert.equal(a.Points, 0);
  // rescoring again is a no-op
  assert.equal((await rescoreQuestion(ctx(store), 1)).changed, 0);
  // and recalc agrees with the rescore's totals
  const snap = snapshot(await store.totalsAll());
  await recalcTotals(ctx(store));
  assert.deepEqual(snapshot(await store.totalsAll()), snap);
});

test('rescore keeps the stored late multiplier', async () => {
  const store = mkStore();
  await store.saveSetting('LATE_MULTIPLIER', '0.5');
  const late = Date.parse('2026-12-10T08:00:00Z');
  await startQuestion({ store, user: user('u'), now: new Date(late) }, 1);
  await answerQuestion({ store, user: user('u'), now: new Date(late) }, 1, 'b'); // 1000 * 0.5
  await store.saveSetting('LATE_MULTIPLIER', '1'); // later changed
  const r = await rescoreQuestion(ctx(store), 1);
  assert.equal(r.changed, 0);
  assert.equal(store._data.attempts[0].Points, 500);
});

test('deleting an attempt removes it, recalculates totals and lets the user retry', async () => {
  const store = mkStore();
  await seed(store);
  const res = await deleteAttempt(ctx(store), 'u2_1');
  assert.equal(res.deleted, 'u2_1');
  const me = await getMe({ store, user: user('u2'), now: at(70000) }, { isAdmin: false });
  assert.equal(me.answeredCount, 1);
  await startQuestion({ store, user: user('u2'), now: at(80000) }, 1); // can start again
  await assert.rejects(deleteAttempt(ctx(store), 'nope_9'), { code: 'not_found' });
});

test('recalc zeroes a user whose only attempts were deleted', async () => {
  const store = mkStore();
  await play(store, 'solo', 1, 'b', 1000);
  await deleteAttempt(ctx(store), 'solo_1');
  const row = store._data.totals.find((t) => t.Title === 'solo');
  assert.equal(row.TotalPoints, 0);
  assert.equal(row.AnsweredCount, 0);
});

test('settings validation and round trip', async () => {
  assert.throws(() => validateSettings({ TIME_LIMIT_SECONDS: '2' }), { code: 'invalid_settings' });
  assert.throws(() => validateSettings({ LATE_MULTIPLIER: '1.5' }), { code: 'invalid_settings' });
  assert.throws(() => validateSettings({ CLOSE_DATE: '31.12.2026' }), { code: 'invalid_settings' });
  assert.throws(() => validateSettings({ REVEAL_NOW: 'yes' }), { code: 'invalid_settings' });
  assert.throws(() => validateSettings({ BOGUS: '1' }), { code: 'invalid_settings' });
  assert.deepEqual(validateSettings({ LATE_MULTIPLIER: '0,5' }), { LATE_MULTIPLIER: '0.5' });

  const store = mkStore();
  const c = ctx(store);
  assert.equal((await adminGetSettings(c)).values.TIME_LIMIT_SECONDS, '30'); // default
  const saved = await adminSaveSettings(c, { TIME_LIMIT_SECONDS: '20', REVEAL_NOW: 'true' });
  assert.equal(saved.values.TIME_LIMIT_SECONDS, '20');
  assert.equal(saved.values.REVEAL_NOW, 'true');
});

test('REVEAL_NOW reveals the correct answer before the close date', async () => {
  const store = mkStore();
  await store.saveSetting('REVEAL_NOW', 'true');
  const r = await play(store, 'u', 1, 'a', 1000);
  assert.equal(r.correctAnswer.optionId, 'b');
});
