import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n/strings.js';

function Door({ n, q, onOpen }) {
  const status = q?.status ?? 'locked';
  const base = 'relative aspect-square rounded-2xl border-2 p-2 flex flex-col items-center justify-center text-center transition';
  const number = <span className="text-3xl font-extrabold leading-none">{n}</span>;

  if (status === 'locked') {
    return (
      <div className={`${base} border-white/10 bg-pine-800/60 text-white/50`} aria-label={`Luke ${n}, ${t.home.locked}`}>
        {number}
        <span className="mt-1 text-xs">🔒 {q ? t.home.locked : t.home.soon}</span>
      </div>
    );
  }

  const style = {
    available: 'border-gold-400 bg-berry-700 shadow-[0_0_16px_rgba(230,195,92,0.45)] hover:scale-[1.03]',
    in_progress: 'border-gold-400 bg-berry-600 shadow-[0_0_16px_rgba(230,195,92,0.45)]',
    answered: q?.isCorrect ? 'border-green-400/70 bg-pine-700' : 'border-red-400/70 bg-pine-700',
    expired: 'border-red-400/70 bg-pine-700',
    closed: 'border-white/20 bg-pine-800',
  }[status];

  let label;
  if (status === 'available') label = t.home.open;
  else if (status === 'in_progress') label = `${t.home.continue} · ${Math.ceil((q.remainingMs ?? 0) / 1000)} s`;
  else if (status === 'answered') label = `${q.isCorrect ? '✓' : '✗'} ${q.points} p`;
  else if (status === 'expired') label = `⏱ ${t.home.expired} · 0 p`;
  else label = t.home.closed;

  return (
    <button className={`${base} ${style}`} onClick={() => onOpen(n)} aria-label={`Luke ${n}: ${label}`}>
      {number}
      <span className="mt-1 text-xs font-medium">{label}</span>
    </button>
  );
}

export default function Home({ me, navigate }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/questions').then(setList).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-300">{error}</p>;
  if (!list) return <p className="text-white/70">{t.loading}</p>;

  const byNo = new Map(list.questions.map((q) => [q.no, q]));
  return (
    <section>
      <div className="mb-5 rounded-2xl bg-pine-800 border border-gold-500/40 p-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-white/70">{me.displayName}</div>
          <div className="text-2xl font-bold text-gold-400">{me.totalPoints.toLocaleString('nb-NO')} {t.home.points}</div>
        </div>
        <div className="text-right text-sm">
          {me.rank && <div>{t.home.rank} {me.rank}/{me.participants}</div>}
          <div className="text-white/80">{me.closed ? t.home.closedBanner : t.home.remaining(me.remaining)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
          <Door key={n} n={n} q={byNo.get(n)} onOpen={(no) => navigate(`/q/${no}`)} />
        ))}
      </div>
    </section>
  );
}
