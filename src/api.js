import { getToken } from './auth/msal.js';

// Authenticated image fetch -> object URL (an <img> tag cannot send a bearer token).
export async function apiImageUrl(path) {
  const token = await getToken();
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`image ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

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
