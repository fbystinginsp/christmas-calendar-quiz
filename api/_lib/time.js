const osloFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' });

// NOW_OVERRIDE is honoured only outside production, so unlock logic can be tested.
export function getNow() {
  const o = process.env.NOW_OVERRIDE;
  if (o && process.env.VERCEL_ENV !== 'production') {
    const d = new Date(o);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

// 'YYYY-MM-DD' in Europe/Oslo
export const osloDate = (d) => osloFmt.format(d);
