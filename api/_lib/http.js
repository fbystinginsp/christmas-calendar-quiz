import { ApiError } from './errors.js';
import { verifyUser, isAdmin } from './auth.js';
import { getStore } from './store/index.js';
import { getNow } from './time.js';

// Wraps a handler: method check, caller verification, admin gate, error mapping.
// fn(ctx, req) returns the JSON body for a 200 response.
export function route(methods, fn, { admin = false } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!methods.includes(req.method)) throw new ApiError(405, 'method_not_allowed', 'Method not allowed');
      const user = await verifyUser(req);
      const admin_ = isAdmin(user);
      if (admin && !admin_) throw new ApiError(403, 'forbidden', 'Admins only');
      const ctx = { store: getStore(), now: getNow(), user, isAdmin: admin_ };
      const body = await fn(ctx, req);
      if (body?.raw) {
        res.setHeader('Content-Type', body.raw.contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.status(200).send(body.raw.buffer);
        return;
      }
      res.status(200).json(body ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) {
        res.status(e.status).json({ error: e.code, message: e.message, ...(e.details || {}) });
      } else {
        console.error(e);
        res.status(500).json({ error: 'server_error', message: 'Something went wrong' });
      }
    }
  };
}

export const queryNo = (req) => {
  const no = Number(req.query.no);
  if (!Number.isInteger(no) || no < 1 || no > 24) throw new ApiError(400, 'invalid_question', 'Bad question number');
  return no;
};
