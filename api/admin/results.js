import { route } from '../_lib/http.js';
import { adminResults } from '../_lib/quiz.js';

export default route(['GET'], (ctx) => adminResults(ctx), { admin: true });
