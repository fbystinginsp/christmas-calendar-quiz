import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n/strings.js';
import AdminResults from './AdminResults.jsx';

const CATEGORIES = ['', 'Jul', 'Norge', 'Danmark', 'Inspirit', 'D365', 'Bilde', 'Kolleger'];
const ids = ['a', 'b', 'c', 'd', 'e'];
const defaultDate = (n) => `2026-12-${String(n).padStart(2, '0')}`;

function blank(no) {
  return {
    no,
    title: `Dag ${no}`,
    unlockDate: defaultDate(no),
    imagePath: '',
    type: 'mc',
    category: '',
    text: '',
    options: ids.slice(0, 4).map((id) => ({ id, text: '' })),
    correctOptionId: 'a',
    correctNumber: '',
    unit: '',
    tolPct: 5,
    zeroPct: 50,
    explanation: '',
  };
}

const inputCls = 'w-full rounded-lg bg-pine-900 border border-white/20 px-3 py-2';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-white/70">{label}</span>
      {children}
    </label>
  );
}

function Editor({ initial, onSaved, onDeleted }) {
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setMsg('');
    try {
      const body = { ...f, options: f.type === 'mc' ? f.options.filter((o) => o.text.trim()) : [] };
      const r = await api('/admin/questions', { method: 'PUT', body });
      setMsg(t.admin.saved);
      onSaved(r.questions);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!window.confirm(t.admin.confirmDelete)) return;
    setBusy(true);
    try {
      const r = await api(`/admin/questions?no=${f.no}`, { method: 'DELETE' });
      onDeleted(r.questions);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl bg-pine-800 border border-gold-500/40 p-4 space-y-3">
      <h2 className="font-bold text-gold-400">{t.admin.slot(f.no)}</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.admin.label}>
          <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label={t.admin.unlockDate}>
          <input className={inputCls} value={f.unlockDate} onChange={(e) => set('unlockDate', e.target.value)} />
        </Field>
        <Field label={t.admin.type}>
          <select className={inputCls} value={f.type} onChange={(e) => set('type', e.target.value)}>
            <option value="mc">{t.admin.mc}</option>
            <option value="estimate">{t.admin.estimate}</option>
          </select>
        </Field>
        <Field label={t.admin.category}>
          <select className={inputCls} value={f.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c || '–'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t.admin.image}>
        <input className={inputCls} placeholder="q05.jpg" value={f.imagePath} onChange={(e) => set('imagePath', e.target.value)} />
      </Field>
      <Field label={t.admin.text}>
        <textarea className={inputCls} rows={3} value={f.text} onChange={(e) => set('text', e.target.value)} />
      </Field>

      {f.type === 'mc' ? (
        <fieldset>
          <legend className="text-sm text-white/70">{t.admin.options}</legend>
          <div className="space-y-2 mt-1">
            {f.options.map((o, i) => (
              <div key={o.id} className="flex items-center gap-2">
                <input type="radio" name="correct" aria-label={`Riktig: ${o.id}`} checked={f.correctOptionId === o.id} onChange={() => set('correctOptionId', o.id)} />
                <input
                  className={inputCls}
                  placeholder={`Alternativ ${o.id.toUpperCase()}`}
                  value={o.text}
                  onChange={(e) => set('options', f.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.admin.correctNumber}>
            <input className={inputCls} inputMode="decimal" value={f.correctNumber} onChange={(e) => set('correctNumber', e.target.value)} />
          </Field>
          <Field label={t.admin.unit}>
            <input className={inputCls} value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          </Field>
          <Field label={t.admin.tolerance}>
            <input className={inputCls} inputMode="decimal" value={f.tolPct} onChange={(e) => set('tolPct', e.target.value)} />
          </Field>
          <Field label={t.admin.zero}>
            <input className={inputCls} inputMode="decimal" value={f.zeroPct} onChange={(e) => set('zeroPct', e.target.value)} />
          </Field>
        </div>
      )}

      <Field label={t.admin.explanation}>
        <textarea className={inputCls} rows={2} value={f.explanation} onChange={(e) => set('explanation', e.target.value)} />
      </Field>

      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-xl bg-gold-500 text-pine-900 font-semibold px-5 py-2 disabled:opacity-60" onClick={save}>
          {t.admin.save}
        </button>
        {initial.exists && (
          <button disabled={busy} className="rounded-xl border border-red-400 text-red-300 px-4 py-2" onClick={del}>
            {t.admin.delete}
          </button>
        )}
        {msg && <span className="text-sm" role="status">{msg}</span>}
      </div>
    </div>
  );
}

function QuestionsAdmin() {
  const [questions, setQuestions] = useState(null);
  const [sel, setSel] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/questions').then((r) => setQuestions(r.questions)).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-300">{error}</p>;
  if (!questions) return <p className="text-white/70">{t.loading}</p>;

  const byNo = new Map(questions.map((q) => [q.no, q]));
  const initialFor = (n) => {
    const q = byNo.get(n);
    if (!q) return { ...blank(n), exists: false };
    const opts = ids.slice(0, Math.max(4, q.options.length)).map((id, i) => q.options[i] || { id, text: '' });
    return { ...blank(n), ...q, options: opts, correctNumber: q.correctNumber ?? '', exists: true };
  };

  return (
    <section>
      <div className="mt-4 grid grid-cols-4 sm:grid-cols-6 gap-2">
        {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => setSel(n)}
            className={`rounded-lg border py-2 text-sm ${sel === n ? 'border-gold-400 bg-gold-500/20' : byNo.has(n) ? 'border-green-400/60 bg-pine-800' : 'border-white/20 bg-pine-900'}`}
            title={byNo.has(n) ? byNo.get(n).title : t.admin.empty}
          >
            {n} {byNo.has(n) ? '✓' : '·'}
          </button>
        ))}
      </div>
      {sel && (
        <Editor
          key={`${sel}-${byNo.get(sel)?.title ?? ''}-${questions.length}`}
          initial={initialFor(sel)}
          onSaved={setQuestions}
          onDeleted={(qs) => {
            setQuestions(qs);
            setSel(null);
          }}
        />
      )}
    </section>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('questions');
  const btn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`rounded-full px-4 py-1.5 text-sm border ${tab === id ? 'bg-gold-500 text-pine-900 border-gold-500 font-semibold' : 'border-white/20'}`}
    >
      {label}
    </button>
  );
  return (
    <section>
      <h1 className="text-2xl font-bold text-gold-400">{t.admin.title}</h1>
      <div className="mt-3 flex gap-2">
        {btn('questions', 'Spørsmål')}
        {btn('results', 'Resultater')}
      </div>
      {tab === 'questions' ? <QuestionsAdmin /> : <AdminResults />}
    </section>
  );
}
