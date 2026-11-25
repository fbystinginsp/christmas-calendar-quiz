import { route, queryNo } from '../../_lib/http.js';
import { startQuestion } from '../../_lib/quiz.js';

export default route(['POST'], (ctx, req) => startQuestion(ctx, queryNo(req)));
