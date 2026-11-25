import { timingSafeEqual } from 'node:crypto';
import { getStore } from '../_lib/store/index.js';
import { getNow } from '../_lib/time.js';
import { snapshotRanks } from '../_lib/maintenance.js';

// Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>" when that env var exists.
function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(String(req.headers.authorization || ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const result = await snapshotRanks({ store: getStore(), now: getNow() });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'snapshot_failed' });
  }
}
