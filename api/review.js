import { route } from './_lib/http.js';
import { getReview } from './_lib/quiz.js';

export default route(['GET'], (ctx) => getReview(ctx));
