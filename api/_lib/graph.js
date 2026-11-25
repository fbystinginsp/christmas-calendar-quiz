import { ApiError } from './errors.js';

let tokenCache = { token: null, exp: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function appToken() {
  if (tokenCache.token && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const { TENANT_ID, API_CLIENT_ID, API_CLIENT_SECRET } = process.env;
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: API_CLIENT_ID,
      client_secret: API_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new ApiError(500, 'store_auth', 'Could not authenticate to storage');
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.token;
}

// App-only Graph call with 429/503 retry (honours Retry-After, max 3 retries).
export async function graph(method, path, { body, headers, retry = 0 } = {}) {
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await appToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 429 || res.status === 503) && retry < 3) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 1), 5) * 1000;
    await sleep(wait);
    return graph(method, path, { body, headers, retry: retry + 1 });
  }
  if (res.status === 429 || res.status === 503) throw new ApiError(503, 'throttled', 'Busy, please try again');
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, ok: res.ok, data };
}
