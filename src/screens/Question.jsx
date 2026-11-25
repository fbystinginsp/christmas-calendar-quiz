import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiImageUrl } from '../api.js';
import { t } from '../i18n/strings.js';
import { useCountdown, useCountUp } from '../hooks.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Result({ no, result, navigate }) {
  const shown = useCountUp(result.points);
  const [next, setNext] = useState(undefined);

  useEffect(() => {
    api('/questions')
      .then((l) => {
        const open = l.questions.filter((q) => q.status === 'available' || q.status === 'in_progress');
        setNext((open.find((q) => q.no > no) ?? open[0])?.no ?? null);
      })
      .catch(() => setNext(null));
  }, [no]);

  const timedOut = result.status === 'expired' || result.expired;
  let headline;
  if (timedOut) headline = `⏱ ${t.question.timeUp}`;
  else if (result.isCorrect) headline = `🎉 ${t.question.correct}`;
  else if (result.percentOff != null && result.points > 0) headline = `👍 ${t.question.close}`;
  else headline = `✗ ${t.question.wrong}`;

  const ca = result.correctAnswer;
  return (
    <div className="rounded-2xl bg-pine-800 border border-gold-500/50 p-6 text-center" role="status">
      <h2 className="text-2xl font-bold">{headline}</h2>
      <div className="mt-4 text-6xl font-extrabold text-gold-400 tabular-nums">{shown}</div>
      <div className="text-white/70">{t.question.points}</div>
      {result.percentOff != null && !timedOut && <p className="mt-3">{t.question.percentOff(result.percentOff)}</p>}
      <div className="mt-3 text-sm text-white/80 space-y-1">
        {result.rankForQuestion && <div>{t.question.rankQuestion(result.rankForQuestion)}</div>}
        {result.rankTotal && <div>{t.question.rankTotal(result.rankTotal)}</div>}
      </div>
      <div className="mt-4 rounded-xl bg-pine-900/60 p-3 text-sm">
        {ca ? (
          <>
            <div className="font-semibold text-gold-400">{t.question.correctAnswer}</div>
            <div>{ca.text ?? `${ca.number} ${ca.unit || ''}`}</div>
            {result.explanation && <p className="mt-2 text-white/80">{result.explanation}</p>}
          </>
        ) : (
          <span className="text-white/70">{t.question.correctAnswerHeld}</span>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <button className="rounded-xl bg-gold-500 text-pine-900 font-semibold py-3" onClick={() => navigate(`/leaderboard?q=${no}`)}>
          {t.question.seeLeaderboard}
        </button>
        {next ? (
          <button className="rounded-xl border border-gold-500 py-3" onClick={() => navigate(`/q/${next}`)}>
            {t.question.next}
          </button>
        ) : (
          <button className="rounded-xl border border-white/30 py-3" onClick={() => navigate('/')}>
            {t.question.back}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Question({ no, navigate, onChange }) {
  const [phase, setPhase] = useState('init'); // init | ready | live | result | locked | closed | error
  const [category, setCategory] = useState('');
  const [live, setLive] = useState(null); // { question, deadlineAt, serverNow, limitMs }
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageState, setImageState] = useState('idle'); // idle | loading | done | failed
  const submitted = useRef(false);

  const showResultFrom = useCallback(
    (r) => {
      setResult(r);
      setPhase('result');
      onChange();
    },
    [onChange],
  );

  const start = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api(`/questions/${no}/start`, { method: 'POST' });
      setLive(data);
      setPhase('live');
    } catch (e) {
      if (e.code === 'already_attempted' && e.data?.result) showResultFrom(e.data.result);
      else if (e.code === 'locked') setPhase('locked');
      else if (e.code === 'closed') setPhase('closed');
      else {
        setError(e.message);
        setPhase('error');
      }
    } finally {
      setBusy(false);
    }
  }, [no, showResultFrom]);

  useEffect(() => {
    let cancelled = false;
    api('/questions')
      .then((l) => {
        if (cancelled) return;
        const q = l.questions.find((x) => x.no === no);
        if (!q || q.status === 'locked') return setPhase('locked');
        setCategory(q.category || '');
        setHasImage(!!q.hasImage);
        if (q.status === 'available') return setPhase('ready');
        if (q.status === 'closed') return setPhase('closed');
        return start(); // in_progress (resume) or answered/expired (shows stored result)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [no, start]);

  // Preload the image before Start so the timer never includes download time.
  useEffect(() => {
    if (!hasImage || imageState !== 'idle') return undefined;
    if (phase !== 'ready' && phase !== 'live') return undefined;
    let cancelled = false;
    setImageState('loading');
    apiImageUrl(`/questions/${no}/image`)
      .then((url) => {
        if (cancelled) return URL.revokeObjectURL(url);
        setImageUrl(url);
        return setImageState('done');
      })
      .catch(() => {
        if (!cancelled) setImageState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [hasImage, imageState, phase, no]);

  useEffect(() => () => imageUrl && URL.revokeObjectURL(imageUrl), [imageUrl]);

  const remaining = useCountdown(live?.deadlineAt, live?.serverNow);
  const timeUp = phase === 'live' && remaining === 0;

  useEffect(() => {
    if (timeUp && !submitted.current) onChange();
  }, [timeUp, onChange]);

  async function submit(answer) {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError('');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await api(`/questions/${no}/answer`, { method: 'POST', body: { answer } });
        showResultFrom(r);
        setBusy(false);
        return;
      } catch (e) {
        if (e.code === 'already_attempted' && e.data?.result) {
          showResultFrom(e.data.result);
          setBusy(false);
          return;
        }
        if (e.status && e.status < 500) {
          setError(e.message);
          submitted.current = false; // e.g. invalid number: allow fixing it
          setBusy(false);
          return;
        }
        if (attempt === 0) {
          setError(t.question.networkRetry);
          await sleep(500);
        } else {
          setError(e.message);
          submitted.current = false;
          setBusy(false);
        }
      }
    }
  }

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <button className="text-white/70 underline" onClick={() => navigate('/')}>
        ← {t.nav.home}
      </button>
      <div className="text-sm text-white/70">
        {t.question.day(no)}
        {category ? ` · ${category}` : ''}
      </div>
    </div>
  );

  if (phase === 'init') return <p className="text-white/70">{t.loading}</p>;
  if (phase === 'locked' || phase === 'closed') {
    return (
      <div>
        {header}
        <p className="rounded-2xl bg-pine-800 p-6 text-center">{phase === 'locked' ? t.question.notYet : t.home.closedBanner}</p>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div>
        {header}
        <p className="rounded-2xl bg-pine-800 p-6 text-center text-red-300">{error}</p>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div>
        {header}
        <div className="rounded-2xl bg-pine-800 border border-gold-500/50 p-8 text-center">
          <div className="text-6xl" aria-hidden="true">🎁</div>
          <h1 className="mt-3 text-2xl font-bold text-gold-400">{t.question.day(no)}</h1>
          <p className="mt-3 text-white/80">{t.question.rules}</p>
          <button disabled={busy || (hasImage && imageState === 'loading')} className="mt-6 w-full rounded-xl bg-gold-500 text-pine-900 text-xl font-bold py-4 disabled:opacity-60" onClick={start}>
            {hasImage && imageState === 'loading' ? t.question.loadingImage : t.question.start}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div>
        {header}
        <Result no={no} result={result} navigate={navigate} />
      </div>
    );
  }

  // live
  const { question, limitMs } = live;
  const secs = remaining == null ? '' : Math.ceil(remaining / 1000);
  const pct = remaining == null ? 100 : Math.max(0, Math.min(100, (remaining / limitMs) * 100));
  const urgent = remaining != null && remaining <= 10000;
  const locked = busy || timeUp || submitted.current;

  return (
    <div>
      {header}
      <div className="mb-4" aria-live="off">
        <div className="flex items-end justify-between mb-1">
          <span className="text-sm text-white/70">{t.question.seconds}</span>
          <span className={`text-3xl font-extrabold tabular-nums ${urgent ? 'text-red-300' : 'text-gold-400'}`}>{secs}</span>
        </div>
        <div className="h-3 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className={`h-full ${urgent ? 'bg-red-400' : 'bg-gold-400'}`} style={{ width: `${pct}%`, transition: 'width 120ms linear' }} />
        </div>
      </div>

      <div className="rounded-2xl bg-pine-800 border border-white/10 p-5">
        {imageUrl && <img src={imageUrl} alt={t.question.imageAlt} className="mb-4 w-full max-h-72 object-contain rounded-xl bg-black/20" />}
        {question.hasImage && !imageUrl && imageState !== 'failed' && <p className="mb-3 text-sm text-white/60">{t.question.loadingImage}</p>}
        {imageState === 'failed' && <p className="mb-3 text-sm text-red-300">{t.question.imageFailed}</p>}
        <h1 className="text-xl font-semibold">{question.text}</h1>

        {question.type === 'mc' ? (
          <div className="mt-5 grid gap-3">
            {question.options.map((o) => (
              <button
                key={o.id}
                disabled={locked}
                onClick={() => {
                  setPicked(o.id);
                  submit(o.id);
                }}
                className={`w-full text-left rounded-xl border-2 px-4 py-4 text-lg disabled:cursor-not-allowed ${
                  picked === o.id ? 'border-gold-400 bg-gold-500/20' : 'border-white/20 bg-pine-900/40 hover:border-gold-400'
                } ${locked && picked !== o.id ? 'opacity-60' : ''}`}
              >
                {o.text}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="mt-5 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (guess.trim() !== '') submit(guess.trim());
            }}
          >
            <label className="text-sm text-white/70" htmlFor="guess">
              {t.question.yourGuess}
              {question.unit ? ` (${question.unit})` : ''}
            </label>
            <input
              id="guess"
              inputMode="decimal"
              autoComplete="off"
              disabled={locked}
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              className="rounded-xl bg-pine-900 border-2 border-white/20 px-4 py-3 text-xl"
            />
            <button disabled={locked || guess.trim() === ''} className="rounded-xl bg-gold-500 text-pine-900 font-bold py-3 disabled:opacity-60">
              {t.question.answer}
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-red-300" role="alert">{error}</p>}
        {timeUp && !busy && (
          <div className="mt-5 text-center">
            <p className="text-xl font-bold text-red-300">⏱ {t.question.timeUp}</p>
            <button className="mt-3 underline" onClick={() => navigate('/')}>
              {t.question.back}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
