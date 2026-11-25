// Graph spike. Run: node --env-file=.env.local scripts/spike.mjs
// Verifies: auth, column index/unique settings, unique-key conflict,
// concurrent-create race, If-Match (ETag) on PATCH. Cleans up after itself.
const { TENANT_ID, API_CLIENT_ID, API_CLIENT_SECRET, SITE_ID, LIST_ATTEMPTS_ID, LIST_QUESTIONS_ID, LIST_TOTALS_ID, LIST_SETTINGS_ID } = process.env;
for (const [k, v] of Object.entries({ TENANT_ID, API_CLIENT_ID, API_CLIENT_SECRET, SITE_ID, LIST_ATTEMPTS_ID, LIST_QUESTIONS_ID, LIST_TOTALS_ID, LIST_SETTINGS_ID }))
  if (!v) { console.error(`Missing env var ${k}`); process.exit(1); }

const G = 'https://graph.microsoft.com/v1.0';
const ok = (c, msg) => console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`);

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: API_CLIENT_ID, client_secret: API_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Token failed: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

const t0 = await token();
const call = (path, opts = {}) => fetch(`${G}${path}`, { ...opts, headers: { Authorization: `Bearer ${t0}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
ok(true, 'Acquired app-only token');

// 1. Column settings
const lists = { QuizQuestions: LIST_QUESTIONS_ID, QuizAttempts: LIST_ATTEMPTS_ID, QuizTotals: LIST_TOTALS_ID, QuizSettings: LIST_SETTINGS_ID };
for (const [name, id] of Object.entries(lists)) {
  const r = await call(`/sites/${SITE_ID}/lists/${id}/columns?$select=name,indexed,enforceUniqueValues&$top=100`);
  if (!r.ok) { ok(false, `Read columns of ${name}: ${r.status} ${await r.text()}`); continue; }
  const cols = (await r.json()).value;
  const flagged = cols.filter(c => c.indexed || c.enforceUniqueValues).map(c => `${c.name}${c.enforceUniqueValues ? '(unique)' : '(indexed)'}`);
  console.log(`      ${name}: ${cols.length} columns; indexed/unique: ${flagged.join(', ') || 'none'}`);
}

// 2. Unique key conflict
const key = `spike_${Date.now()}`;
const create = () => call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items`, { method: 'POST', body: JSON.stringify({ fields: { Title: key, UserId: 'spike', QuestionNo: 99, Status: 'started' } }) });
const first = await create();
ok(first.status === 201, `First create returned ${first.status}`);
const item = await first.json();
const second = await create();
const secondBody = await second.text();
ok(second.status >= 400, `Duplicate create rejected with ${second.status}  ->  ${secondBody.slice(0, 160)}`);

// 3. Concurrent race on one new key
const raceKey = `${key}_race`;
const raceCreate = () => call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items`, { method: 'POST', body: JSON.stringify({ fields: { Title: raceKey, UserId: 'spike', QuestionNo: 99, Status: 'started' } }) });
const results = await Promise.all(Array.from({ length: 10 }, raceCreate));
const wins = results.filter(r => r.status === 201).length;
ok(wins === 1, `10 concurrent creates of the same key: ${wins} succeeded (want exactly 1). Statuses: ${results.map(r => r.status).join(',')}`);
const raceId = (await Promise.all(results.filter(r => r.status === 201).map(r => r.json())))[0]?.id;

// 4. If-Match
const etag = item['@odata.etag'];
console.log(`      Item etag: ${etag}`);
const patch = (tag) => call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items/${item.id}/fields`, { method: 'PATCH', headers: tag ? { 'If-Match': tag } : {}, body: JSON.stringify({ Status: 'answered' }) });
const p1 = await patch(etag);
ok(p1.ok, `PATCH with the current etag: ${p1.status}`);
const p2 = await patch(etag);
ok(p2.status === 412, `PATCH reusing the now-stale etag: ${p2.status} (want 412)`);

// 5. Cleanup
for (const id of [item.id, raceId].filter(Boolean)) await call(`/sites/${SITE_ID}/lists/${LIST_ATTEMPTS_ID}/items/${id}`, { method: 'DELETE' });
console.log('Cleaned up test rows.');
