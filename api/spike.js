// TEMPORARY: Graph spike endpoint. Protected by CRON_SECRET. Delete after use.
import { timingSafeEqual } from 'node:crypto';

const G = 'https://graph.microsoft.com/v1.0';

function authorized(req) {
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  const given = String(req.headers.authorization || '');
  if (!process.env.CRON_SECRET || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const { TENANT_ID, API_CLIENT_ID, API_CLIENT_SECRET, SITE_ID, LIST_ATTEMPTS_ID, LIST_QUESTIONS_ID, LIST_TOTALS_ID, LIST_SETTINGS_ID } = process.env;
  const missing = Object.entries({ TENANT_ID, API_CLIENT_ID, API_CLIENT_SECRET, SITE_ID, LIST_ATTEMPTS_ID, LIST_QUESTIONS_ID, LIST_TOTALS_ID, LIST_SETTINGS_ID }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return res.status(500).json({ error: 'missing_env', missing });

  const out = [];
  const log = (pass, msg) => out.push(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'}  ${msg}`);

  try {
    const tr = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: API_CLIENT_ID, client_secret: API_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    const tj = await tr.json();
    if (!tr.ok) { log(false, `Token: ${tj.error} - ${String(tj.error_description || '').split('\r')[0]}`); return res.status(200).json({ results: out }); }
    log(true, 'Acquired app-only token');

    const call = (path, opts = {}) => fetch(`${G}${path}`, { ...opts, headers: { Authorization: `Bearer ${tj.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

    const lists = { QuizQuestions: LIST_QUESTIONS_ID, QuizAttempts: LIST_ATTEMPTS_ID, QuizTotals: LIST_TOTALS_ID, QuizSettings: LIST_SETTINGS_ID };
    for (const [name, id] of Object.entries(lists)) {
      const r = await call(`/sites/${SITE_ID}/lists/${id}/columns?$select=name,indexed,enforceUniqueValues&$top=100`);
      if (!r.ok) { log(false, `Read columns of ${name}: ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
      const cols = (await r.json()).value;
      const flagged = cols.filter(c => c.indexed || c.enforceUniqueValues).map(c => `${c.name}${c.enforceUniqueValues ? '(unique)' : '(indexed)'}`);
      log(null, `${name}: ${cols.length} columns; indexed/unique: ${flagged.join(', ') || 'none'}`);
    }

    const key = `spike_${Date.now()}`;
    const fields = (k) => ({ fields: { Title: k, UserId: 'spike', QuestionNo: 99, Status: 'started' } });
    const create = (k) => call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items`, { method: 'POST', body: JSON.stringify(fields(k)) });

    const first = await create(key);
    log(first.status === 201, `First create returned ${first.status}`);
    if (first.status !== 201) { log(null, (await first.text()).slice(0, 300)); return res.status(200).json({ results: out }); }
    const item = await first.json();

    const second = await create(key);
    log(second.status >= 400, `Duplicate create: ${second.status} -> ${(await second.text()).slice(0, 200)}`);

    const results = await Promise.all(Array.from({ length: 10 }, () => create(`${key}_race`)));
    const wins = results.filter(r => r.status === 201);
    log(wins.length === 1, `10 concurrent creates of one key: ${wins.length} succeeded (want 1). Statuses: ${results.map(r => r.status).join(',')}`);
    const raceId = wins.length ? (await wins[0].json()).id : null;

    const etag = item['@odata.etag'];
    log(null, `Item etag: ${etag}`);
    const patch = (tag) => call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items/${item.id}/fields`, { method: 'PATCH', headers: tag ? { 'If-Match': tag } : {}, body: JSON.stringify({ Status: 'answered' }) });
    const p1 = await patch(etag);
    log(p1.ok, `PATCH with current etag: ${p1.status}`);
    const p2 = await patch(etag);
    log(p2.status === 412, `PATCH with stale etag: ${p2.status} (want 412)`);

    for (const id of [item.id, raceId].filter(Boolean)) await call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items/${id}`, { method: 'DELETE' });
    log(null, 'Cleaned up test rows');
  } catch (e) {
    log(false, `Exception: ${e.message}`);
  }
  res.status(200).json({ results: out });
}
