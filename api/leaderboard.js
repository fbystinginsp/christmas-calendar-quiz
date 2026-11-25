import { route } from './_lib/http.js';
import { getLeaderboard } from './_lib/quiz.js';

export default route(['GET'], (ctx, req) => getLeaderboard(ctx, { scope: req.query.scope === 'question' ? 'question' : 'total', no: req.query.no }));
