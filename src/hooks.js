import { useEffect, useRef, useState } from 'react';

// Countdown driven by server time: offset is computed once so a wrong device clock doesn't matter.
export function useCountdown(deadlineAt, serverNow) {
  const offset = useRef(0);
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!deadlineAt || !serverNow) {
      setRemaining(null);
      return undefined;
    }
    offset.current = Date.parse(serverNow) - Date.now();
    const deadline = Date.parse(deadlineAt);
    const tick = () => setRemaining(Math.max(0, deadline - (Date.now() + offset.current)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadlineAt, serverNow]);

  return remaining;
}

export function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!target) {
      setV(0);
      return undefined;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setV(target);
      return undefined;
    }
    const t0 = performance.now();
    let raf;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
