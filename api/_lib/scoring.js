// Kahoot-style: 1000 at 0s -> 500 at the limit (scaled by base).
export function speedPoints(elapsedMs, limitMs, base = 1000) {
  const t = Math.min(Math.max(elapsedMs, 0), limitMs) / limitMs;
  return Math.round(base * (1 - t / 2));
}

// tolPct / zeroPct are percentages (5, 50). Returns accuracy 0..1.
export function estimateAccuracy(guess, truth, tolPct = 5, zeroPct = 50) {
  const tol = tolPct / 100;
  const zero = zeroPct / 100;
  const relErr = Math.abs(guess - truth) / Math.max(Math.abs(truth), 1e-9);
  if (relErr <= tol) return 1;
  if (relErr >= zero) return 0;
  return 1 - (relErr - tol) / (zero - tol);
}

export function relativeErrorPct(guess, truth) {
  return Math.round((Math.abs(guess - truth) / Math.max(Math.abs(truth), 1e-9)) * 100);
}
