import { route } from '../_lib/http.js';
import { ApiError } from '../_lib/errors.js';
import { adminListQuestions, validateQuestionInput } from '../_lib/quiz.js';

export default route(
  ['GET', 'POST', 'PUT', 'DELETE'],
  async (ctx, req) => {
    if (req.method === 'GET') return adminListQuestions(ctx);
    if (req.method === 'DELETE') {
      const no = Number(req.query.no);
      if (!Number.isInteger(no)) throw new ApiError(400, 'invalid_question', 'Bad question number');
      await ctx.store.deleteQuestion(no);
      return adminListQuestions(ctx);
    }
    await ctx.store.saveQuestion(validateQuestionInput(req.body || {}));
    return adminListQuestions(ctx);
  },
  { admin: true },
);
