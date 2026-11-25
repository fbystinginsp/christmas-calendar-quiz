import { route } from './_lib/http.js';
import { getMe } from './_lib/quiz.js';

export default route(['GET'], (ctx) => getMe(ctx, { isAdmin: ctx.isAdmin }));
