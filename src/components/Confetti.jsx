import { useEffect, useMemo, useState } from 'react';

const COLORS = ['#e6c35c', '#d4a937', '#a52222', '#2f8f5b', '#ffffff'];
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// One-shot celebration for a correct answer. Unmounts itself after the animation.
export default function Confetti({ count = 44 }) {
  const [done, setDone] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (k) => ((i * 7919 + k * 15485863) % 104729) / 104729;
        return {
          left: `${(r(1) * 100).toFixed(1)}%`,
          color: COLORS[i % COLORS.length],
          delay: r(2) * 0.5,
          duration: 1.8 + r(3) * 1.4,
          rotate: Math.round(r(4) * 720),
          drift: `${Math.round((r(5) - 0.5) * 160)}px`,
          w: 6 + Math.round(r(6) * 6),
        };
      }),
    [count],
  );
  useEffect(() => {
    const id = setTimeout(() => setDone(true), 4200);
    return () => clearTimeout(id);
  }, []);
  if (done || reduced()) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{ left: p.left, background: p.color, width: p.w, height: p.w * 1.6, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, '--drift': p.drift, '--rot': `${p.rotate}deg` }}
        />
      ))}
    </div>
  );
}
