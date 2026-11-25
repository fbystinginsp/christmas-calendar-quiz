import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';

const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

// Proves identity by forwarding the caller's Graph token to GET /me.
export async function verifyUser(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized', 'Missing token');
  const token = header.slice(7);
  const key = createHash('sha256').update(token).digest('hex');

  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.user;

  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new ApiError(401, 'unauthorized', 'Invalid token');
  const j = await r.json();
  const user = { id: j.id, displayName: j.displayName || j.userPrincipalName || 'Ukjent', mail: j.mail || j.userPrincipalName || '' };

  if (cache.size > 500) cache.clear();
  cache.set(key, { user, exp: Date.now() + TTL_MS });
  return user;
}

export function isAdmin(user) {
  return (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(user.id).toLowerCase());
}
