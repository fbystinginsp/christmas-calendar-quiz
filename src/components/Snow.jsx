import { useMemo } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Subtle falling snow. Decorative only: hidden from assistive tech, off for reduced motion.
export default function Snow({ count = 36 }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (k) => ((i * 9301 + k * 49297) % 233280) / 233280; // deterministic pseudo-random
        return {
          left: `${(r(1) * 100).toFixed(1)}%`,
          size: 3 + Math.round(r(2) * 4),
          duration: 11 + r(3) * 14,
          delay: -r(4) * 25,
          drift: `${Math.round((r(5) - 0.5) * 120)}px`,
          opacity: 0.35 + r(6) * 0.45,
        };
      }),
    [count],
  );
  if (reduced()) return null;
  return (
    <div className="snow" aria-hidden="true">
      {flakes.map((f, i) => (
        <span
          key={i}
          style={{ left: f.left, width: f.size, height: f.size, opacity: f.opacity, animationDuration: `${f.duration}s`, animationDelay: `${f.delay}s`, '--drift': f.drift }}
        />
      ))}
    </div>
  );
}
