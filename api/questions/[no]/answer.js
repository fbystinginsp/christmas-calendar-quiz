import { route, queryNo } from '../../_lib/http.js';
import { answerQuestion } from '../../_lib/quiz.js';

export default route(['POST'], (ctx, req) => answerQuestion(ctx, queryNo(req), req.body?.answer));
