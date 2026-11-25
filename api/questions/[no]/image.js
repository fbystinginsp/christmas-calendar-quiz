import { route, queryNo } from '../../_lib/http.js';
import { getQuestionImage } from '../../_lib/quiz.js';

export default route(['GET'], (ctx, req) => getQuestionImage(ctx, queryNo(req)));
