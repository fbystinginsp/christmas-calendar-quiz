import { getToken } from './auth/msal.js';

export async function api(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const r = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.message || data.error || `HTTP ${r.status}`);
    e.status = r.status;
    e.code = data.error;
    e.data = data;
    throw e;
  }
  return data;
}
