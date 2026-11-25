import { StoreError } from '../errors.js';

// In-memory driver with the same behaviour as the SharePoint one
// (unique keys, etag conflicts). Used by tests and local experiments.
export function createMemoryStore({ settings = {}, questions = [] } = {}) {
  let seq = 0;
  const nextId = () => String(++seq);
  const tag = () => `"${++seq}"`;
  const data = {
    settings: { ...settings },
    questions: questions.map((q) => ({ id: nextId(), etag: tag(), ...q })),
    attempts: [],
    totals: [],
  };

  const create = (name, uniqueField, fields) => {
    if (data[name].some((r) => r[uniqueField] === fields[uniqueField])) throw new StoreError('exists');
    const rec = { id: nextId(), etag: tag(), ...fields };
    data[name].push(rec);
    return { ...rec };
  };
  const update = (name, rec, patch) => {
    const cur = data[name].find((r) => r.id === rec.id);
    if (!cur || cur.etag !== rec.etag) throw new StoreError('conflict');
    Object.assign(cur, patch, { etag: tag() });
    return { ...cur };
  };

  return {
    _data: data,
    async settings() {
      return { ...data.settings };
    },
    async saveSetting(k, v) {
      data.settings[k] = String(v);
    },

    async questions() {
      return data.questions.map((r) => ({ ...r }));
    },
    async saveQuestion(fields) {
      const cur = data.questions.find((q) => Number(q.QuestionNo) === Number(fields.QuestionNo));
      if (cur) Object.assign(cur, fields, { etag: tag() });
      else data.questions.push({ id: nextId(), etag: tag(), ...fields });
    },
    async deleteQuestion(no) {
      const i = data.questions.findIndex((q) => Number(q.QuestionNo) === Number(no));
      if (i < 0) return false;
      data.questions.splice(i, 1);
      return true;
    },

    async allAttempts() {
      return data.attempts.map((r) => ({ ...r }));
    },
    async attemptsForUser(userId) {
      return data.attempts.filter((a) => a.UserId === userId).map((r) => ({ ...r }));
    },
    async attemptsForQuestion(no) {
      return data.attempts.filter((a) => Number(a.QuestionNo) === Number(no)).map((r) => ({ ...r }));
    },
    async getAttempt(key) {
      const a = data.attempts.find((r) => r.Title === key);
      return a ? { ...a } : null;
    },
    async createAttempt(fields) {
      return create('attempts', 'Title', fields);
    },
    async updateAttempt(rec, patch) {
      return update('attempts', rec, patch);
    },

    async totalsAll() {
      return data.totals.map((r) => ({ ...r }));
    },
    async getTotals(userId) {
      const t = data.totals.find((r) => r.Title === userId);
      return t ? { ...t } : null;
    },
    async createTotals(fields) {
      return create('totals', 'Title', fields);
    },
    async updateTotals(rec, patch) {
      return update('totals', rec, patch);
    },
  };
}
