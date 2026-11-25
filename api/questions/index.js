import { route } from '../_lib/http.js';
import { listQuestions } from '../_lib/quiz.js';

export default route(['GET'], (ctx) => listQuestions(ctx));
