import { route } from '../_lib/http.js';
import { ApiError } from '../_lib/errors.js';
import { adminGetSettings, adminSaveSettings, recalcTotals, rescoreQuestion, deleteAttempt } from '../_lib/maintenance.js';

// One function for all admin maintenance, to stay under the Hobby plan function limit.
//   GET    ?op=settings            PUT ?op=settings  { KEY: value, ... }
//   POST   ?op=recalc              POST ?op=rescore  { no }
//   DELETE ?op=attempt&key=...
export default route(
  ['GET', 'PUT', 'POST', 'DELETE'],
  async (ctx, req) => {
    const op = req.query.op;
    const m = req.method;
    if (op === 'settings' && m === 'GET') return adminGetSettings(ctx);
    if (op === 'settings' && m === 'PUT') return adminSaveSettings(ctx, req.body || {});
    if (op === 'recalc' && m === 'POST') return recalcTotals(ctx);
    if (op === 'rescore' && m === 'POST') {
      const no = Number(req.body?.no);
      if (!Number.isInteger(no) || no < 1 || no > 24) throw new ApiError(400, 'invalid_question', 'Bad question number');
      return rescoreQuestion(ctx, no);
    }
    if (op === 'attempt' && m === 'DELETE') return deleteAttempt(ctx, req.query.key);
    throw new ApiError(400, 'bad_request', 'Unknown operation');
  },
  { admin: true },
);
