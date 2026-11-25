import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n/strings.js';

const inputCls = 'w-full rounded-lg bg-pine-900 border border-white/20 px-3 py-2';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm text-white/80">{label}</span>
      {children}
      {hint && <span className="block text-xs text-white/50 mt-1">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm text-white/90">{label}</span>
        {hint && <span className="block text-xs text-white/50">{hint}</span>}
      </span>
    </label>
  );
}

function Tools() {
  const [no, setNo] = useState(1);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(label, confirmText, call) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(`${label} …`);
    try {
      const r = await call();
      setMsg(`${label}: ${JSON.stringify(r)}`);
    } catch (e) {
      setMsg(`${label} feilet: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-pine-800 border border-white/10 p-4 space-y-4">
      <h2 className="font-bold text-gold-400">Vedlikehold</h2>

      <div>
        <button
          disabled={busy}
          className="rounded-xl border border-gold-500 px-4 py-2 disabled:opacity-60"
          onClick={() => run('Omberegning', 'Bygge opp totalene på nytt fra alle svar?', () => api('/admin/manage?op=recalc', { method: 'POST' }))}
        >
          Beregn totaler på nytt
        </button>
        <p className="text-xs text-white/50 mt-1">Bygger toppliste-totalene på nytt fra alle registrerte svar. Trygt å kjøre når som helst.</p>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <select aria-label="Spørsmål" className="rounded-lg bg-pine-900 border border-white/20 px-3 py-2" value={no} onChange={(e) => setNo(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Spørsmål {n}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            className="rounded-xl border border-gold-500 px-4 py-2 disabled:opacity-60"
            onClick={() =>
              run('Ny poengberegning', `Vurdere alle svar på spørsmål ${no} på nytt mot dagens fasit, og oppdatere totalene?`, () =>
                api('/admin/manage?op=rescore', { method: 'POST', body: { no } }),
              )
            }
          >
            Beregn spørsmålet på nytt
          </button>
        </div>
        <p className="text-xs text-white/50 mt-1">Bruk etter at du har rettet en feil fasit eller toleranse. Alle svar på spørsmålet vurderes på nytt, og totalene oppdateres.</p>
      </div>

      {msg && (
        <p className="text-sm break-words" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

export default function AdminSettings() {
  const [v, setV] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/admin/manage?op=settings')
      .then((r) => setV(r.values))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="mt-4 text-red-300">{error}</p>;
  if (!v) return <p className="mt-4 text-white/70">{t.loading}</p>;

  const set = (k, val) => setV((p) => ({ ...p, [k]: String(val) }));
  const bool = (k) => v[k] === 'true';

  async function save() {
    setBusy(true);
    setMsg('');
    try {
      const r = await api('/admin/manage?op=settings', { method: 'PUT', body: v });
      setV(r.values);
      setMsg(`${t.admin.saved}. Endringer kan ta opptil ett minutt å slå inn for alle.`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl bg-pine-800 border border-gold-500/40 p-4 space-y-4">
        <h2 className="font-bold text-gold-400">Innstillinger</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tidsgrense (sekunder)">
            <input className={inputCls} inputMode="numeric" value={v.TIME_LIMIT_SECONDS} onChange={(e) => set('TIME_LIMIT_SECONDS', e.target.value)} />
          </Field>
          <Field label="Nettverksmargin (ms)" hint="Ekstra tid på selve svar-kallet. Gir aldri ekstra poeng.">
            <input className={inputCls} inputMode="numeric" value={v.GRACE_MS} onChange={(e) => set('GRACE_MS', e.target.value)} />
          </Field>
          <Field label="Siste svardag (ÅÅÅÅ-MM-DD)" hint="Inkludert. Etter denne datoen er quizen stengt.">
            <input className={inputCls} value={v.CLOSE_DATE} onChange={(e) => set('CLOSE_DATE', e.target.value)} />
          </Field>
          <Field label="Sen-spilling-multiplikator (0–1)" hint="1 = ingen straff. 0,5 = halv poengsum for svar etter dagen spørsmålet åpnet.">
            <input className={inputCls} inputMode="decimal" value={v.LATE_MULTIPLIER} onChange={(e) => set('LATE_MULTIPLIER', e.target.value)} />
          </Field>
        </div>
        <Toggle label="Vis riktige svar etter siste svardag" checked={bool('REVEAL_AT_CLOSE')} onChange={(c) => set('REVEAL_AT_CLOSE', c)} />
        <Toggle label="Vis riktige svar NÅ" hint="Overstyrer alt over. Bruk først når du er sikker på at ingen skal få hint." checked={bool('REVEAL_NOW')} onChange={(c) => set('REVEAL_NOW', c)} />
        <div className="flex items-center gap-3">
          <button disabled={busy} className="rounded-xl bg-gold-500 text-pine-900 font-semibold px-5 py-2 disabled:opacity-60" onClick={save}>
            {t.admin.save}
          </button>
          {msg && (
            <span className="text-sm" role="status">
              {msg}
            </span>
          )}
        </div>
      </div>
      <Tools />
    </div>
  );
}
