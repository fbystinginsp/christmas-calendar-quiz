import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n/strings.js';

export default function MyAnswers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/review').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-300">{error}</p>;
  if (!data) return <p className="text-white/70">{t.loading}</p>;

  return (
    <section>
      <h1 className="text-2xl font-bold text-gold-400">{t.answers.title}</h1>
      {data.items.length === 0 && <p className="mt-4 text-white/70">{t.answers.empty}</p>}
      {!data.reveal && data.items.length > 0 && <p className="mt-3 text-sm text-white/70">{t.answers.held}</p>}
      <div className="mt-4 space-y-3">
        {data.items.map((i) => {
          const ok = i.status === 'answered' && i.isCorrect;
          const ca = i.correctAnswer;
          return (
            <article key={i.no} className="rounded-2xl bg-pine-800 border border-white/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-white/60">
                    {t.question.day(i.no)}
                    {i.category ? ` · ${i.category}` : ''}
                    {i.status === 'answered' && !i.onTheDay ? ` · ${t.answers.late}` : ''}
                  </div>
                  <h2 className="font-semibold">{i.text}</h2>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-bold text-gold-400">{i.points} p</div>
                  <div className="text-sm" aria-label={ok ? t.question.correct : t.question.wrong}>
                    {i.status === 'expired' ? '⏱' : ok ? '✓' : '✗'}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-sm">
                <span className="text-white/60">{t.answers.yourAnswer}: </span>
                {i.status === 'expired' ? t.answers.noAnswer : i.yourAnswer}
              </p>
              {ca && (
                <div className="mt-2 rounded-xl bg-pine-900/60 p-3 text-sm">
                  <span className="text-gold-400 font-semibold">{t.answers.correctAnswer}: </span>
                  {ca.text ?? `${ca.number} ${ca.unit || ''}`}
                  {i.explanation && <p className="mt-1 text-white/80">{i.explanation}</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
