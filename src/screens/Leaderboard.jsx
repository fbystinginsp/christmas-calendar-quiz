import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n/strings.js';

const fmtAvg = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);

function Badges({ badges = [] }) {
  return badges.map((b) => {
    const [icon, label] = t.badges[b] || [];
    return icon ? (
      <span key={b} className="ml-1" role="img" aria-label={label} title={label}>
        {icon}
      </span>
    ) : null;
  });
}

function Change({ value }) {
  if (!value) return null;
  return (
    <span className={`ml-2 text-xs ${value > 0 ? 'text-green-300' : 'text-red-300'}`} aria-label={value > 0 ? `opp ${value} plasser` : `ned ${-value} plasser`}>
      {value > 0 ? `▲${value}` : `▼${-value}`}
    </span>
  );
}

function Row({ r, cols }) {
  return (
    <tr className={r.isMe ? 'bg-gold-500/20 font-semibold' : 'odd:bg-white/5'}>
      <td className="py-2 pl-3 w-10">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
      <td className="py-2 pr-2">
        {r.displayName}
        {r.isMe ? ' (deg)' : ''}
        <Badges badges={r.badges} />
        <Change value={r.rankChange} />
      </td>
      {cols(r)}
    </tr>
  );
}

export default function Leaderboard() {
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState(params.get('q') ? 'question' : 'total');
  const [questions, setQuestions] = useState([]);
  const [no, setNo] = useState(Number(params.get('q')) || null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/questions')
      .then((l) => {
        const played = l.questions.filter((q) => q.status === 'answered' || q.status === 'expired');
        setQuestions(played);
        setNo((cur) => cur ?? played.at(-1)?.no ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setData(null);
    setError('');
    if (tab === 'question' && !no) return;
    api(tab === 'total' ? '/leaderboard?scope=total' : `/leaderboard?scope=question&no=${no}`)
      .then(setData)
      .catch((e) => setError(e.code === 'not_answered' ? t.leaderboard.hidden : e.message));
  }, [tab, no]);

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`flex-1 rounded-xl py-2 border ${tab === id ? 'bg-gold-500 text-pine-900 border-gold-500 font-semibold' : 'border-white/20'}`}
    >
      {label}
    </button>
  );

  return (
    <section>
      <h1 className="text-2xl font-bold text-gold-400">{t.leaderboard.title}</h1>
      <div className="mt-4 flex gap-2">
        {tabBtn('total', t.leaderboard.total)}
        {tabBtn('question', t.leaderboard.perQuestion)}
      </div>

      {tab === 'question' && (
        <div className="mt-3">
          {questions.length === 0 ? (
            <p className="text-white/70">{t.leaderboard.hidden}</p>
          ) : (
            <select
              aria-label={t.leaderboard.pickQuestion}
              className="w-full rounded-xl bg-pine-800 border border-white/20 p-2"
              value={no ?? ''}
              onChange={(e) => setNo(Number(e.target.value))}
            >
              {questions.map((q) => (
                <option key={q.no} value={q.no}>
                  {t.question.day(q.no)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-pine-800 border border-white/10 overflow-hidden">
        {error && <p className="p-4 text-white/80">{error}</p>}
        {!error && !data && <p className="p-4 text-white/70">{t.loading}</p>}
        {data && data.rows.length === 0 && <p className="p-4 text-white/70">{t.leaderboard.empty}</p>}
        {data && data.rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-white/60">
              <tr>
                <th className="py-2 pl-3">#</th>
                <th>{t.leaderboard.name}</th>
                {data.scope === 'total' ? (
                  <>
                    <th className="text-right">{t.leaderboard.pts}</th>
                    <th className="text-right">{t.leaderboard.correct}</th>
                    <th className="text-right pr-3">{t.leaderboard.avg}</th>
                  </>
                ) : (
                  <>
                    <th className="text-right">{t.leaderboard.pts}</th>
                    <th className="text-right pr-3">Tid</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <Row
                  key={`${r.rank}-${r.displayName}`}
                  r={r}
                  cols={(x) =>
                    data.scope === 'total' ? (
                      <>
                        <td className="text-right">{x.totalPoints.toLocaleString('nb-NO')}</td>
                        <td className="text-right">{x.correctCount}/{x.answeredCount}</td>
                        <td className="text-right pr-3">{fmtAvg(x.avgCorrectMs)}</td>
                      </>
                    ) : (
                      <>
                        <td className="text-right">{x.points}</td>
                        <td className="text-right pr-3">{fmtAvg(x.elapsedMs)}</td>
                      </>
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
