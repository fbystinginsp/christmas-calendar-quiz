import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n/strings.js';

const secs = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' }) : '');
const statusLabel = { answered: 'Svart', expired: 'Tid ute', started: 'Pågår' };

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-pine-800 border border-white/10 p-3 text-center">
      <div className="text-2xl font-bold text-gold-400">{value}</div>
      <div className="text-xs text-white/70">{label}</div>
    </div>
  );
}

function Table({ head, children }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-pine-800 border border-white/10">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="text-left text-white/60">
          <tr>
            {head.map((h) => (
              <th key={h} className="py-2 px-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function AdminResults() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterNo, setFilterNo] = useState('');
  const [view, setView] = useState('questions');
  const [note, setNote] = useState('');

  const load = () => {
    setData(null);
    setError('');
    api('/admin/results').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function remove(a) {
    const ok = window.confirm(`Slette forsøket til ${a.displayName} på spørsmål ${a.no}? Totalene beregnes på nytt, og personen kan spille spørsmålet på nytt.`);
    if (!ok) return;
    try {
      await api(`/admin/manage?op=attempt&key=${encodeURIComponent(a.key)}`, { method: 'DELETE' });
      setNote(`Slettet: ${a.displayName}, spørsmål ${a.no}`);
      load();
    } catch (e) {
      setNote(`Kunne ikke slette: ${e.message}`);
    }
  }

  const attempts = useMemo(() => {
    if (!data) return [];
    const needle = filterName.trim().toLowerCase();
    return data.attempts.filter((a) => (!filterNo || a.no === Number(filterNo)) && (!needle || a.displayName.toLowerCase().includes(needle)));
  }, [data, filterName, filterNo]);

  if (error) return <p className="mt-4 text-red-300">{error}</p>;
  if (!data) return <p className="mt-4 text-white/70">{t.loading}</p>;

  const s = data.summary;
  const tab = (id, label) => (
    <button
      onClick={() => setView(id)}
      aria-pressed={view === id}
      className={`rounded-full px-4 py-1.5 text-sm border ${view === id ? 'bg-gold-500 text-pine-900 border-gold-500 font-semibold' : 'border-white/20'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Deltakere" value={s.participants} />
        <Stat label="Svar" value={s.answered} />
        <Stat label="Tid ute" value={s.expired} />
        <Stat label="Pågår" value={s.inProgress} />
        <Stat label="Forsøk totalt" value={s.attempts} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tab('questions', 'Per spørsmål')}
        {tab('participants', 'Deltakere')}
        {tab('attempts', 'Alle svar')}
        <button className="ml-auto rounded-full border border-white/20 px-4 py-1.5 text-sm" onClick={load}>
          Oppdater
        </button>
      </div>

      {view === 'questions' && (
        <Table head={['#', 'Spørsmål', 'Riktig svar', 'Svart', '% riktig', 'Snitt poeng', 'Snitt tid', 'Tid ute', 'Pågår', 'Mest valgte feil']}>
          {data.perQuestion.map((q) => (
            <tr key={q.no} className="odd:bg-white/5">
              <td className="py-2 px-3">{q.no}</td>
              <td className="px-3">{q.title}</td>
              <td className="px-3">{q.correctAnswer}</td>
              <td className="px-3">{q.answered}</td>
              <td className="px-3">{q.correctPct == null ? '–' : `${q.correctPct} %`}</td>
              <td className="px-3">{q.avgPoints ?? '–'}</td>
              <td className="px-3">{secs(q.avgElapsedMs)}</td>
              <td className="px-3">{q.expired}</td>
              <td className="px-3">{q.inProgress}</td>
              <td className="px-3">{q.topWrong ? `${q.topWrong.answer} (${q.topWrong.count})` : '–'}</td>
            </tr>
          ))}
        </Table>
      )}

      {view === 'participants' && (
        <Table head={['#', 'Navn', 'Poeng', 'Riktige', 'Besvart', 'Snitt tid (riktige)']}>
          {data.participants.map((p) => (
            <tr key={`${p.rank}-${p.displayName}`} className="odd:bg-white/5">
              <td className="py-2 px-3">{p.rank}</td>
              <td className="px-3">{p.displayName}</td>
              <td className="px-3">{p.totalPoints.toLocaleString('nb-NO')}</td>
              <td className="px-3">{p.correctCount}</td>
              <td className="px-3">{p.answeredCount}</td>
              <td className="px-3">{secs(p.avgCorrectMs)}</td>
            </tr>
          ))}
        </Table>
      )}

      {view === 'attempts' && (
        <>
          <div className="flex gap-2">
            <input
              aria-label="Søk på navn"
              placeholder="Søk på navn"
              className="flex-1 rounded-lg bg-pine-900 border border-white/20 px-3 py-2"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
            />
            <select aria-label="Filtrer spørsmål" className="rounded-lg bg-pine-900 border border-white/20 px-3 py-2" value={filterNo} onChange={(e) => setFilterNo(e.target.value)}>
              <option value="">Alle spørsmål</option>
              {data.perQuestion.map((q) => (
                <option key={q.no} value={q.no}>
                  {q.no}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-white/60">{attempts.length} rader</p>
          {note && <p className="text-sm" role="status">{note}</p>}
          <Table head={['Startet', 'Navn', '#', 'Status', 'Svar', 'Riktig', 'Poeng', 'Tid', 'På dagen', '']}>
            {attempts.map((a, i) => (
              <tr key={`${a.displayName}-${a.no}-${i}`} className="odd:bg-white/5">
                <td className="py-2 px-3">{when(a.startedAt)}</td>
                <td className="px-3">{a.displayName}</td>
                <td className="px-3">{a.no}</td>
                <td className="px-3">{statusLabel[a.status] || a.status}</td>
                <td className="px-3 max-w-[16rem] truncate">{a.answer}</td>
                <td className="px-3">{a.status === 'answered' ? (a.isCorrect ? '✓' : '✗') : '–'}</td>
                <td className="px-3">{a.points}</td>
                <td className="px-3">{secs(a.elapsedMs)}</td>
                <td className="px-3">{a.status === 'answered' ? (a.onTheDay ? 'Ja' : 'Nei') : '–'}</td>
                <td className="px-3">
                  <button className="text-red-300 underline" onClick={() => remove(a)}>
                    Slett
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
