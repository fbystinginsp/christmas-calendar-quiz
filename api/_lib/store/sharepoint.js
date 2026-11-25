import { graph } from '../graph.js';
import { ApiError, StoreError } from '../errors.js';

const TTL_MS = 60_000;
const esc = (v) => String(v).replace(/'/g, "''");

function failure(r) {
  const msg = typeof r.data === 'string' ? r.data : r.data?.error?.message || '';
  return new ApiError(502, 'store_error', `Storage error ${r.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`);
}

const toRecord = (item) => ({ id: item.id, etag: item['@odata.etag'], ...item.fields });

export function createSharePointStore() {
  const site = () => process.env.SITE_ID;
  const lists = () => ({
    questions: process.env.LIST_QUESTIONS_ID,
    attempts: process.env.LIST_ATTEMPTS_ID,
    totals: process.env.LIST_TOTALS_ID,
    settings: process.env.LIST_SETTINGS_ID,
  });
  const base = (name) => `/sites/${site()}/lists/${lists()[name]}/items`;

  async function listItems(name, filter) {
    let url = `${base(name)}?$expand=fields&$top=999${filter ? `&$filter=${encodeURIComponent(filter)}` : ''}`;
    const out = [];
    while (url) {
      const r = await graph('GET', url);
      if (!r.ok) throw failure(r);
      out.push(...r.data.value.map(toRecord));
      url = r.data['@odata.nextLink'] || null;
    }
    return out;
  }

  async function createItem(name, fields) {
    const r = await graph('POST', base(name), { body: { fields } });
    if (r.status === 201) return toRecord(r.data);
    if (r.status === 400 && /unique constraints/i.test(JSON.stringify(r.data))) throw new StoreError('exists');
    throw failure(r);
  }

  async function updateItem(name, rec, patch) {
    const r = await graph('PATCH', `${base(name)}/${rec.id}/fields`, { body: patch, headers: { 'If-Match': rec.etag } });
    if (r.status === 412) throw new StoreError('conflict');
    if (!r.ok) throw failure(r);
    return { ...rec, ...patch, etag: r.data?.['@odata.etag'] || rec.etag };
  }

  let settingsCache = { exp: 0, value: null };
  let questionsCache = { exp: 0, value: null };

  return {
    async settings() {
      if (settingsCache.value && settingsCache.exp > Date.now()) return settingsCache.value;
      const items = await listItems('settings');
      const value = Object.fromEntries(items.map((i) => [i.Title, i.Value]));
      settingsCache = { exp: Date.now() + TTL_MS, value };
      return value;
    },
    async saveSetting(key, value) {
      const existing = (await listItems('settings', `fields/Title eq '${esc(key)}'`))[0];
      if (existing) await updateItem('settings', existing, { Value: String(value) });
      else await createItem('settings', { Title: key, Value: String(value) });
      settingsCache = { exp: 0, value: null };
    },

    async questions() {
      if (questionsCache.value && questionsCache.exp > Date.now()) return questionsCache.value;
      const value = await listItems('questions');
      questionsCache = { exp: Date.now() + TTL_MS, value };
      return value;
    },
    async saveQuestion(fields) {
      const existing = (await listItems('questions', `fields/QuestionNo eq ${Number(fields.QuestionNo)}`))[0];
      if (existing) await updateItem('questions', existing, fields);
      else await createItem('questions', fields);
      questionsCache = { exp: 0, value: null };
    },
    async deleteQuestion(no) {
      const existing = (await listItems('questions', `fields/QuestionNo eq ${Number(no)}`))[0];
      if (!existing) return false;
      const r = await graph('DELETE', `${base('questions')}/${existing.id}`);
      if (!r.ok) throw failure(r);
      questionsCache = { exp: 0, value: null };
      return true;
    },

    attemptsForUser: (userId) => listItems('attempts', `fields/UserId eq '${esc(userId)}'`),
    attemptsForQuestion: (no) => listItems('attempts', `fields/QuestionNo eq ${Number(no)}`),
    async getAttempt(key) {
      return (await listItems('attempts', `fields/Title eq '${esc(key)}'`))[0] || null;
    },
    createAttempt: (fields) => createItem('attempts', fields),
    updateAttempt: (rec, patch) => updateItem('attempts', rec, patch),

    totalsAll: () => listItems('totals'),
    async getTotals(userId) {
      return (await listItems('totals', `fields/Title eq '${esc(userId)}'`))[0] || null;
    },
    createTotals: (fields) => createItem('totals', fields),
    updateTotals: (rec, patch) => updateItem('totals', rec, patch),
  };
}
