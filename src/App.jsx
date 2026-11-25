import { useCallback, useEffect, useState } from 'react';
import { initAuth, login, signOutAndClear } from './auth/msal.js';
import { api } from './api.js';
import { useRoute } from './router.js';
import { t } from './i18n/strings.js';
import Home from './screens/Home.jsx';
import Question from './screens/Question.jsx';
import Leaderboard from './screens/Leaderboard.jsx';
import About from './screens/About.jsx';
import Admin from './screens/Admin.jsx';

function Centered({ children }) {
  return <main className="min-h-screen flex items-center justify-center p-4">{children}</main>;
}

function Card({ children }) {
  return <div className="w-full max-w-md rounded-2xl bg-pine-800 border border-gold-500/60 p-8 text-center shadow-xl">{children}</div>;
}

function ErrorScreen({ message }) {
  return (
    <Centered>
      <Card>
        <h1 className="text-2xl font-bold text-gold-400">{t.errorTitle}</h1>
        <p className="mt-3 text-white/80 break-words">{message}</p>
        <div className="mt-6 flex flex-col gap-3">
          <button className="rounded-xl bg-gold-500 text-pine-900 font-semibold py-3" onClick={() => window.location.reload()}>
            {t.retry}
          </button>
          <button className="underline text-white/70" onClick={signOutAndClear}>
            {t.signOutClear}
          </button>
        </div>
      </Card>
    </Centered>
  );
}

export default function App() {
  const [auth, setAuth] = useState({ state: 'loading' });
  const [me, setMe] = useState(null);
  const [path, navigate] = useRoute();

  useEffect(() => {
    initAuth()
      .then((account) => setAuth(account ? { state: 'ready' } : { state: 'signedout' }))
      .catch((e) => setAuth({ state: 'error', message: e.message }));
  }, []);

  const refreshMe = useCallback(
    () =>
      api('/me')
        .then(setMe)
        .catch((e) => setAuth({ state: 'error', message: e.message })),
    [],
  );

  useEffect(() => {
    if (auth.state === 'ready') refreshMe();
  }, [auth.state, refreshMe]);

  if (auth.state === 'loading') return <Centered><p className="text-white/70">{t.loading}</p></Centered>;
  if (auth.state === 'error') return <ErrorScreen message={auth.message} />;
  if (auth.state === 'signedout') {
    return (
      <Centered>
        <Card>
          <div className="text-5xl" aria-hidden="true">🎄</div>
          <h1 className="mt-3 text-3xl font-bold text-gold-400">{t.appName}</h1>
          <p className="mt-3 text-white/80">{t.loginIntro}</p>
          <button className="mt-6 w-full rounded-xl bg-gold-500 hover:bg-gold-400 text-pine-900 font-semibold py-3" onClick={login}>
            {t.login}
          </button>
        </Card>
      </Centered>
    );
  }
  if (!me) return <Centered><p className="text-white/70">{t.loading}</p></Centered>;

  const qMatch = path.match(/^\/q\/(\d+)$/);
  let screen;
  if (qMatch) screen = <Question key={qMatch[1]} no={Number(qMatch[1])} navigate={navigate} onChange={refreshMe} />;
  else if (path === '/leaderboard') screen = <Leaderboard navigate={navigate} />;
  else if (path === '/about') screen = <About />;
  else if (path === '/admin' && me.isAdmin) screen = <Admin />;
  else screen = <Home me={me} navigate={navigate} />;

  const navItems = [
    ['/', t.nav.home],
    ['/leaderboard', t.nav.leaderboard],
    ['/about', t.nav.about],
    ...(me.isAdmin ? [['/admin', t.nav.admin]] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-pine-900/95 backdrop-blur border-b border-gold-500/30">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
          <button className="font-bold text-gold-400 text-left" onClick={() => navigate('/')}>
            🎄 {t.appName}
          </button>
          <div className="text-right text-sm leading-tight">
            <div className="font-semibold">{me.totalPoints.toLocaleString('nb-NO')} {t.home.points}</div>
            {me.rank && <div className="text-white/70">{t.home.rank} {me.rank}/{me.participants}</div>}
          </div>
        </div>
        <nav className="mx-auto max-w-3xl px-4 pb-2 flex gap-2 overflow-x-auto" aria-label="Hovedmeny">
          {navItems.map(([to, label]) => {
            const active = to === '/' ? path === '/' || path.startsWith('/q/') : path === to;
            return (
              <button
                key={to}
                onClick={() => navigate(to)}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-4 py-1.5 text-sm whitespace-nowrap border ${active ? 'bg-gold-500 text-pine-900 border-gold-500 font-semibold' : 'border-white/20 text-white/80'}`}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{screen}</main>
    </div>
  );
}
