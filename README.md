# Inspirit Julequiz 2026

Advent-calendar quiz for Inspirit colleagues: one question per day, 1-24 December 2026, Kahoot-style speed scoring, no catch-up deadline, total and per-question leaderboards. The full requirements are in [christmas-quiz-spec.md](christmas-quiz-spec.md).

**Stack:** React 18 + Vite + Tailwind (SPA), MSAL sign-in, Vercel serverless functions in `/api`, SharePoint Lists as the database (via Graph, app-only).

## How it fits together

```
Browser (SPA) --Bearer Graph token--> /api/*  --app-only Graph--> SharePoint site Julequiz2026
```

- The browser only talks to `/api`. It never reads SharePoint.
- The API verifies the caller by sending their token to Graph `GET /me`, and requires the token's tenant (`tid`) to equal `TENANT_ID` (blocks personal and other-tenant accounts).
- Correct answers, timing and scoring live only in the API. Time is always the server's clock.
- Options are shuffled per user (seeded by user id + question number). The client sends option ids, not positions.

### Code map

| Path | What |
|---|---|
| `api/_lib/quiz.js` | Core rules: unlock, start, answer, scoring flow, totals, leaderboards, badges, review, admin results |
| `api/_lib/maintenance.js` | Settings, recalc, re-score, delete attempt, nightly snapshot |
| `api/_lib/scoring.js`, `shuffle.js`, `time.js` | Pure helpers (unit tested) |
| `api/_lib/store/` | Storage drivers: `sharepoint.js` (real) and `memory.js` (tests). Swap point if the database ever changes |
| `api/_lib/auth.js`, `http.js`, `graph.js` | Token verification, route wrapper, Graph client (token cache, 429 retry) |
| `api/*.js`, `api/questions/`, `api/admin/`, `api/cron/` | Routes (11 functions; Vercel Hobby allows 12) |
| `src/screens/` | Home (calendar), Question, Leaderboard, MyAnswers, About, Admin (+Results, Settings) |
| `src/i18n/strings.js` | All UI text (Norwegian Bokmal) |
| `tests/` | `npm test` (Node's built-in runner; runs the logic against the in-memory store) |

## Configuration

Public values (client id, tenant id) are in [src/config.js](src/config.js). Everything else is a Vercel environment variable; `.env.example` lists them. Never commit `.env*` (except the example).

| Variable | Notes |
|---|---|
| `TENANT_ID`, `API_CLIENT_ID`, `API_CLIENT_SECRET` | "Inspirit Julequiz API" registration. The secret expires 24 months after creation |
| `SITE_ID`, `LIST_QUESTIONS_ID`, `LIST_ATTEMPTS_ID`, `LIST_TOTALS_ID`, `LIST_SETTINGS_ID` | SharePoint site and lists |
| `ADMIN_USER_IDS` | Comma-separated Entra Object IDs. Enforced server-side |
| `CRON_SECRET` | Vercel Cron sends it automatically as a bearer token |
| `NOW_OVERRIDE` | ISO timestamp for testing. Ignored when `VERCEL_ENV=production` |

SharePoint lists: `QuizQuestions`, `QuizAttempts`, `QuizTotals`, `QuizSettings` (column names in the spec; the question type column is `QuestionType`). Images go in the site's `Shared Documents` library, folder `QuizImages`.

## Running the admin side

Admin tab (visible only to `ADMIN_USER_IDS`):

- **Spørsmål:** create/edit the 24 questions. Image field takes a file name from `QuizImages`.
- **Resultater:** per-question stats, participants, every attempt (with delete).
- **Innstillinger:** time limit, grace, close date, late multiplier, reveal now. Maintenance: recalculate totals, re-score a question (use after fixing a wrong key).

Changes to questions and settings can take up to 60 seconds to reach every server instance (in-memory cache).

## Dry run before launch

Production ignores `NOW_OVERRIDE`, so rehearse on a **Preview** deployment:

1. Create separate test lists (or a separate test site) so rehearsal data never reaches the real leaderboard, and point the Preview environment variables at them.
2. Add a stable preview URL as a SPA redirect URI in the sign-in app registration (Entra does not allow wildcards).
3. Set `NOW_OVERRIDE` (Preview only) to `2026-12-01T09:00:00+01:00`, then `2026-12-20T09:00:00+01:00`.
4. Play with 3-5 colleagues, then clear the test lists.

## Launch checklist

- [ ] All 24 questions entered, unlock dates correct, images uploaded
- [ ] `CLOSE_DATE`, `LATE_MULTIPLIER` confirmed in Admin > Innstillinger
- [ ] `NOW_OVERRIDE` removed from Production
- [ ] One colleague (non-admin) can sign in and play without any consent prompt
- [ ] Test attempts deleted; totals recalculated (Admin > Innstillinger)
- [ ] API client secret expiry is after 31 Dec 2026

## Known limits

- Right/wrong and points are visible immediately, so colleagues can still hint "not B". `LATE_MULTIPLIER` is the lever if that becomes a problem.
- Images can be fetched before pressing Start (needed so download time is not on the clock). They are never public and never before their unlock date.
- On the Vercel Hobby plan cron runs have hourly precision: the nightly rank snapshot may run any time in the hour after 00:05.
- Not built (spec "optional modules"): streak bonus, Norway vs Denmark, Teams reminder, final recap page, per-question statistics for players.
