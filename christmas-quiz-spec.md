# Inspirit Julequiz 2026: Build Specification

An advent-calendar quiz for Inspirit colleagues (Norway and Denmark). One question per day from 1 to 24 December. Kahoot-style speed scoring, immediate points, no catch-up deadline, daily and total leaderboards.

This document is the input for Claude Code. Build in the order given in section 17. Items marked **[DECISION]** have a default but should be confirmed.

---

## 1. Summary of agreed requirements

| Area | Decision |
|---|---|
| Format | One question per day, 1-24 December 2026 (24 questions, weekends included) |
| Unlock time | 00:00 Europe/Oslo on the question's date (Norway and Denmark share the timezone) |
| Catch-up | **No deadline.** A user can start playing at any point and answer every unlocked question, e.g. first visit on 20 December gives access to questions 1-20 |
| Timer | **30 seconds** per question, started by the user pressing **Start** |
| Attempts | Exactly **one** attempt per user per question |
| Scoring | Kahoot-style: correct = 500-1000 points depending on speed; wrong or late = 0 |
| Feedback | Points shown **immediately** after answering |
| Leaderboards | Total leaderboard and per-question ("daily") leaderboard |
| Googling | Made unprofitable by the timer, server-side timing, shuffled option order and held-back correct answers |
| Platform | React 18 + Vite + Tailwind, MSAL, Vercel (static site + serverless functions), SharePoint Lists as the database |
| Azure | Reuse the existing SPA app registration ("Inspirit VM i fotball") for sign-in; add a separate registration for the server-side function |

---

## 2. Architecture

```
Browser (React SPA)
  - MSAL sign-in (redirect flow), scope: User.Read only
  - Talks ONLY to /api/*  (never to SharePoint or Graph lists directly)
        |
        v
Vercel serverless functions (/api)
  - Verify the caller by forwarding the bearer token to Graph GET /me
  - Hold the correct answers, do all timing and scoring
  - Read/write SharePoint Lists with an app-only identity (client credentials, Sites.Selected)
        |
        v
SharePoint site "Julequiz2026" (lists, owners-only permissions)
```

**Why a backend function is required.** Points are shown immediately, so the correct answer must be checked on the spot. If the answers sat in a SharePoint list readable by the user's own token, any colleague could read them via Graph. The function is the only component that can read the answers, and it is also the only trusted source of time.

**What carries over from the World Cup app.** Tailwind and Vite setup, `msalAuth.js` pattern (change to redirect flow, see 4.3), leaderboard component, admin gate by Object ID, Vercel + GitHub auto-deploy workflow. The existing local project is at `C:\Users\FredrikBysting\Downloads\worldcup-predictor\worldcup-predictor` and can be used as reference. `graphService.js` is **not** reused client-side; Graph list access now lives in `/api`.

---

## 3. Azure setup

### 3.1 Registration A: existing SPA registration ("Inspirit VM i fotball")

Reuse the existing Application (client) ID and Tenant ID.

1. Authentication > Single-page application: **add** redirect URIs for the new Vercel URL (e.g. `https://julequiz-xxxx.vercel.app`) and `http://localhost:5173`. Keep the existing World Cup URIs.
2. The quiz app requests **only `User.Read`** at login. It does not use `Sites.ReadWrite.All`, which remains on the registration for the World Cup app and is simply not requested here.
3. Optional: rename the registration (display name only) to something neutral such as "Inspirit apps". The client ID does not change. The old name would otherwise appear on the sign-in screen.

### 3.2 Registration B: new "Inspirit Julequiz API" (server side)

1. Create a new app registration, single tenant.
2. Certificates & secrets: create a client secret (note the expiry; set it beyond 31 Dec 2026).
3. API permissions: Microsoft Graph > **Application** permissions > `Sites.Selected`. Grant admin consent.
4. Grant this app access to the quiz site only (one-time, as an admin), via Graph:
   `POST /sites/{siteId}/permissions` with body
   `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<API app client id>","displayName":"Inspirit Julequiz API"}}]}`
5. Store in Vercel environment variables (see section 14). Never commit the secret.

### 3.3 SharePoint site

Create a new team/communication site `Julequiz2026` (e.g. `inspiritportal.sharepoint.com/sites/Julequiz2026`). Keep it **owners only**. Regular users never need access to the site, because all data goes through the API. This also means a user cannot browse the lists even if they find the URL.

---

## 4. Authentication

### 4.1 Sign-in
MSAL (`@azure/msal-browser`, `@azure/msal-react`), single tenant, `cacheLocation: localStorage`.

### 4.2 Verifying the user in the API
Every API request carries `Authorization: Bearer <Graph access token>`. The function calls `GET https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName` with that token. A 200 response proves identity; the returned `id` is the userId used everywhere. Cache the verified result in memory for about 5 minutes, keyed by a hash of the token, to avoid a Graph call per request.

Reject if the call fails (401). Do not trust any userId sent from the client.

*Alternative (more formal, more setup):* expose an API scope on Registration B, request it from the SPA, and validate the JWT against the tenant JWKS with `jose`. Not needed for v1.

### 4.3 Popup vs redirect
Use `loginRedirect` and `acquireTokenRedirect` as the fallback, not popups. This avoids the popup-blocker problems seen in the World Cup app, and mobile browsers handle it better. Handle `handleRedirectPromise()` on startup. Remember the lesson about stale MSAL cache: provide a "Sign out and clear cache" link on the error screen.

### 4.4 Admin
Admins are identified by Azure AD Object IDs in the `ADMIN_USER_IDS` environment variable (comma-separated). Admin endpoints verify this server-side. The UI also hides the Admin menu for non-admins, but the server check is the real gate.

---

## 5. SharePoint lists

All lists live in the `Julequiz2026` site. Use simple internal names (no spaces or special characters).

### 5.1 `QuizQuestions` (contains correct answers: API access only)

| Column | Type | Notes |
|---|---|---|
| Title | Single line | Short admin label, e.g. "Dag 5 - Gløgg" |
| QuestionNo | Number (0 decimals) | 1-24, **indexed**, unique |
| UnlockDate | Single line | `YYYY-MM-DD` (text avoids timezone problems) |
| Type | Choice | `mc` (multiple choice), `estimate` (numeric guess) |
| Category | Choice | Optional: Jul, Norge, Danmark, Inspirit, D365, Bilde, Kolleger |
| QuestionText | Multiple lines (plain) | |
| ImagePath | Single line | Relative path, e.g. `/img/q05.jpg`. Neutral filenames, no hints |
| OptionsJson | Multiple lines (plain) | For `mc`: `[{"id":"a","text":"..."},{"id":"b","text":"..."}]`, 2-5 options |
| CorrectOptionId | Single line | For `mc` |
| CorrectNumber | Number (decimals allowed) | For `estimate` |
| Unit | Single line | Optional, e.g. "km", "stk" |
| TolerancePct | Number | Estimate: full points within this relative error. Default 5 |
| ZeroPct | Number | Estimate: zero points at or beyond this relative error. Default 50 |
| BasePoints | Number | Default 1000 |
| Explanation | Multiple lines | Shown after the quiz closes (and in "My answers") |

### 5.2 `QuizAttempts`

| Column | Type | Notes |
|---|---|---|
| Title | Single line | **AttemptKey** = `{userId}_{questionNo}`, **indexed + enforce unique values**. This makes a double Start impossible |
| UserId | Single line | Indexed |
| DisplayName | Single line | |
| QuestionNo | Number | Indexed |
| Status | Choice | `started`, `answered`, `expired` |
| StartedAt | Single line | ISO timestamp (server time) |
| AnsweredAt | Single line | ISO timestamp (server time) |
| ElapsedMs | Number | Server-measured |
| AnswerValue | Single line | Option id or the number entered |
| IsCorrect | Yes/No | For estimates: true only when accuracy = 1 |
| Accuracy | Number | 0-1 (estimates; 1 or 0 for mc) |
| SpeedPoints | Number | Before accuracy and multipliers |
| LateMultiplier | Number | See 8.4 |
| Points | Number | Final points |
| OnTheDay | Yes/No | Answered on the question's own calendar day (Oslo time) |

### 5.3 `QuizTotals` (denormalised, one row per user)

| Column | Type | Notes |
|---|---|---|
| Title | Single line | **UserId**, unique, indexed |
| DisplayName | Single line | |
| Office | Choice | `NO`, `DK` (only if office module enabled) |
| TotalPoints | Number | |
| CorrectCount | Number | |
| AnsweredCount | Number | |
| TotalCorrectTimeMs | Number | Sum of elapsed time on correct answers; tie-breaker |
| RankSnapshot | Number | Rank at the last nightly snapshot (for "biggest mover") |
| PointsSnapshot | Number | Points at the last snapshot |

The leaderboard is then a single read of about 150 rows. No need to aggregate thousands of attempt rows.

### 5.4 `QuizSettings` (key/value)

| Key | Default | Meaning |
|---|---|---|
| TIME_LIMIT_SECONDS | 30 | |
| GRACE_MS | 1500 | Network allowance on the answer request |
| CLOSE_DATE | 2026-12-31 | Last day answers are accepted (inclusive, Oslo time) |
| REVEAL_AT_CLOSE | true | Correct answers revealed to everyone after the close date |
| LATE_MULTIPLIER | 1.0 | See 8.4 |
| FEATURE_STREAK | false | Optional module |
| FEATURE_OFFICE | false | Optional module |

Editable from the admin panel; cached in the function for about 60 seconds.

---

## 6. API design

All routes under `/api`, JSON in and out. Every route verifies the user (4.2). Errors return `{ "error": "code", "message": "..." }` with a proper status code.

| Route | Method | Purpose |
|---|---|---|
| `/api/me` | GET | Profile, admin flag, settings relevant to the UI, server time, totals |
| `/api/questions` | GET | List of **unlocked** questions with the user's status per question (no question text for locked ones; no answers ever) |
| `/api/questions/[no]/start` | POST | Starts the attempt, returns the question and the deadline |
| `/api/questions/[no]/answer` | POST | Body `{ "answer": "b" }` or `{ "answer": 42.5 }`. Returns the result |
| `/api/leaderboard` | GET | `?scope=total` or `?scope=question&no=5` |
| `/api/review` | GET | The user's answered questions with correct answer and explanation (only after reveal) |
| `/api/admin/questions` | GET/POST/PUT/DELETE | Question CRUD (includes correct answers) |
| `/api/admin/settings` | GET/PUT | Settings |
| `/api/admin/attempts` | GET | Attempts overview, for support |
| `/api/admin/recalc` | POST | Rebuild `QuizTotals` from `QuizAttempts` (safety net) |
| `/api/cron/snapshot` | GET | Nightly rank snapshot, protected by `CRON_SECRET` |

### 6.1 `GET /api/questions` response (per question)

```json
{
  "no": 5, "unlockDate": "2026-12-05", "category": "Norge",
  "type": "mc", "imagePath": "/img/q05.jpg",
  "status": "available | in_progress | answered | expired | locked",
  "points": 870,
  "remainingMs": 12000
}
```

The image path is included for unlocked questions so the client can **preload images before the user presses Start** (the timer must not run while an image downloads). Question text and options are only returned by `start`.

### 6.2 `POST /api/questions/[no]/start`

1. Reject if the question is locked (`unlockDate > today Oslo`) or the quiz is closed.
2. Try to create the `QuizAttempts` row with `Status=started`, `StartedAt=now`. The unique AttemptKey column guarantees only one succeeds. If the row already exists:
   - `answered` or `expired`: return 409 `already_attempted` with the stored result.
   - `started` and deadline not passed: **resume**, return the same question with the remaining time. (Covers page reloads or a flaky connection.)
   - `started` and deadline passed: mark `expired`, 0 points, return 409.
3. Return `{ question, startedAt, deadlineAt, serverNow }`. Options are **shuffled per user** (see 9.1).

### 6.3 `POST /api/questions/[no]/answer`

1. Load the attempt. It must be `started`. Otherwise 409.
2. `elapsed = now - StartedAt`. If `elapsed > limit + GRACE_MS`: mark `expired`, 0 points, return the result.
3. Score (section 8). Update the attempt using the item's **ETag in an `If-Match` header**, so a double submit or two tabs cannot score twice.
4. Update the user's `QuizTotals` row (create if missing).
5. Return the result:

```json
{
  "isCorrect": true, "accuracy": 1, "points": 870, "elapsedMs": 8700,
  "onTheDay": true, "totalPoints": 5210, "rankTotal": 12, "rankForQuestion": 3,
  "correctAnswer": null
}
```

`correctAnswer` and `explanation` are `null` until the reveal (section 9.2).

---

## 7. Time handling

- **The server is the only clock that counts.** `StartedAt` and `AnsweredAt` are both stamped in the function.
- The client countdown is cosmetic. It uses `deadlineAt` and `serverNow` from the start response (compute the offset once), so a user's wrong device clock does not matter.
- "Today" is `new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now)`, which gives `YYYY-MM-DD`. Compare as strings against `UnlockDate`, `CLOSE_DATE`.
- 1 December 2026 is a Tuesday; 24 December 2026 is a Thursday.
- Testing: support an env var `NOW_OVERRIDE` (ISO timestamp), honoured **only** when `VERCEL_ENV !== 'production'`, so unlock logic can be tested without waiting for December.

---

## 8. Scoring

### 8.1 Multiple choice

```js
function speedPoints(elapsedMs, limitMs, base = 1000) {
  const t = Math.min(elapsedMs, limitMs) / limitMs;   // 0..1
  return Math.round(base * (1 - t / 2));              // 1000 at 0s -> 500 at the limit
}
// correct: points = speedPoints * lateMultiplier, wrong: 0
```

With a 30-second limit, answering after 15 seconds gives 750 points.

### 8.2 Estimation questions (closest-guess)

```js
const relErr = Math.abs(guess - truth) / Math.max(Math.abs(truth), 1e-9);
const accuracy = relErr <= tol ? 1
               : relErr >= zero ? 0
               : 1 - (relErr - tol) / (zero - tol);   // tol, zero from TolerancePct/ZeroPct as fractions
points = Math.round(speedPoints * accuracy * lateMultiplier);
```

A guess within 5% earns full speed points; the score tapers to 0 at 50% error. `IsCorrect` is true only when accuracy is 1; the UI shows how close the guess was ("You were 12% off").

### 8.3 Tie-breaking (total leaderboard)
1. Higher `TotalPoints`
2. Lower `TotalCorrectTimeMs`
3. Higher `CorrectCount`
4. Earlier first answer

### 8.4 Late-play multiplier **[DECISION]**
Because there is no catch-up deadline, someone who starts on 20 December can learn from colleagues who already played. The setting `LATE_MULTIPLIER` multiplies points when `OnTheDay = false`.

- **Default: 1.0** (no penalty, as requested).
- If you want a gentle nudge to play on the day, set 0.5 in the admin panel at any time. It applies to answers from that moment on, and `LateMultiplier` is stored per attempt so history stays correct.

---

## 9. Cheat resistance

The goal is not to make cheating impossible. It is to make it not worth the effort.

### 9.1 Built-in
- **Server-side timing**, one attempt, unique key (sections 5.2 and 6.2).
- **Per-user shuffled option order.** Seeded pseudo-random order using `hash(userId + ':' + questionNo)` (e.g. mulberry32). "It's the third option" no longer works between colleagues. The client submits the option **id**, not its position.
- **Correct answers never reach the browser** before the reveal.
- **Time pressure.** 30 seconds is tight for a Google search plus reading, especially on questions that are not simple facts.
- **No re-attempts.** A reload resumes the same attempt with the same deadline.

### 9.2 Reveal policy
The result screen shows correct/wrong and points immediately. The **correct answer and explanation** are held back until `CLOSE_DATE` has passed (`REVEAL_AT_CLOSE`), so someone who answered on Saturday cannot tell a colleague the right answer before Monday. After the close, "My answers" shows everything, and the admin may reveal earlier from the admin panel.

### 9.3 Known limitations (be honest in the "About" page)
- Right/wrong and points are visible immediately, so colleagues can still share hints like "not B". The late multiplier (8.4) is the lever if this becomes a problem.
- Someone can search on a second device within the 30 seconds. Question design is the main defence (section 12).

### 9.4 Latency
`GRACE_MS` (default 1500) is added to the limit on the **answer request only**, to absorb a slow mobile connection. Scoring uses `min(elapsed, limit)`, so the grace never earns extra points.

---

## 10. Leaderboards

### 10.1 Total
- Source: `QuizTotals`, sorted per 8.3.
- Shows rank, name, points, correct answers (e.g. `14/17`), average answer time.
- Top 20 plus the user's own row highlighted, even if outside the top 20.
- Badges: 🥇 leader, 🚀 biggest mover (rank change versus `RankSnapshot`), 🥄 wooden spoon (last place among those with at least one answer), ⚡ fastest correct average.

### 10.2 Per question ("daily") **[DECISION]**
Because players answer questions on different days, the daily leaderboard is **per question**: everyone who answered question N, ranked by points (then by lower elapsed time). Default view is the latest unlocked question, with a day picker to switch. Visible **only after the user has answered that question**, so it cannot hint at the answer.

### 10.3 Nightly snapshot
Vercel Cron calls `/api/cron/snapshot` at `5 23 * * *` (UTC), which is 00:05 in Norway and Denmark during winter. It writes `RankSnapshot` and `PointsSnapshot` for every user. "Biggest mover" compares the current rank with the snapshot.

---

## 11. User interface

Mobile first (most colleagues will play on their phones), works well on desktop. Language: **[DECISION]** Norwegian Bokmål by default, with all text in `src/i18n/strings.js` so it can be switched or made bilingual easily.

### 11.1 Look
Christmas theme: deep green and dark red with gold accents, subtle falling-snow animation (respect `prefers-reduced-motion`), card-based layout like the World Cup app. Never rely on colour alone to convey state (icons plus text).

### 11.2 Screens

1. **Login.** One button, "Logg inn med Inspirit-konto". Redirect flow.
2. **Home: advent calendar.** A grid of 24 doors.
   - Future door: locked, shows the date.
   - Available: glowing, tap to open.
   - In progress: "Fortsett" with remaining time.
   - Answered: shows points earned (green tick or red cross).
   - Expired (started but not answered): shows 0.
   - Header: total points, rank, and "X spørsmål igjen".
3. **Question: ready.** Shows category and the rules ("30 sekunder, bare ett forsøk"), image preloaded, big **Start** button. Nothing about the question text is visible yet.
4. **Question: live.** Question text, image, options as large tap targets (or a numeric input for estimates), a countdown bar that changes colour in the last 10 seconds, plus the remaining seconds as text. Answering locks the choice immediately (one tap; for estimates an explicit "Svar" button).
5. **Question: result.** Animated points count-up, confetti on a correct answer, "Du var X% unna" for estimates, rank among those who have answered, buttons "Se toppliste" and "Neste spørsmål" (next available).
6. **Leaderboard.** Tabs: Total / Spørsmål, with a day picker for the latter.
7. **My answers.** Per answered question: your answer, points, and (after the reveal) the correct answer plus explanation.
8. **About / rules.** Scoring explanation, the "no deadline" rule, how timing works, fairness notes (9.3), contact for problems.
9. **Admin** (admins only), see section 13.

### 11.3 Behaviour details
- Preload images for all unlocked questions after login, so timers do not include image download time.
- If the tab is hidden or the app is backgrounded mid-question, the countdown keeps running (it is server-based); do not pause it.
- On resume after reload, show the question with the remaining time. If time has run out, show the expired state.
- Disable double-tap: after tapping an option, the request is sent once and the buttons lock.
- Network failure on submit: retry once automatically within the remaining window; otherwise show a clear message. The grace period covers short delays.

---

## 12. Question design guidelines (for the admin)

Mix the types so that Googling does not help much within 30 seconds:

- **Colleague and Inspirit questions**, e.g. "Who is in this baby photo?", "In what year did the Oslo office move to ...?"
- **Local traditions** in Norway and Denmark (julebord, pinnekjøtt vs flæskesteg, nisser, julekalender classics).
- **Estimation questions**, e.g. number of glasses of gløgg, kilometres, counts. Closest-guess scoring (8.2).
- **Picture questions**: a crop of a decoration, a landmark, a product.
- **D365 trivia** for fun, e.g. "What is the default number of ... in ...?"
- Prefer questions where all four options look plausible and the answer needs recognition rather than lookup.
- Keep the question text short enough to read in 5 seconds.

Images: put files in `public/img/` with neutral names (`q05.jpg`, never `gloegg.jpg`), under about 300 KB, 16:9 or 4:3.

---

## 13. Admin panel

Access: users whose Object ID is in `ADMIN_USER_IDS`.

1. **Questions.** List of 24 slots. Create/edit form with type switch, text, options with a "correct" radio button (or the numeric answer, unit and tolerance), image path, category, unlock date, explanation, and a **preview** that renders exactly what the player sees (without starting an attempt).
2. **Settings.** Time limit, grace, close date, late multiplier, feature flags, manual reveal button.
3. **Participants and attempts.** Table with filters (user, question). Useful for support, such as "I pressed start by accident" (admin can delete a single attempt, with a confirmation and the totals recalculated).
4. **Recalculate.** Rebuilds `QuizTotals` from `QuizAttempts`. Use it after deleting an attempt or fixing a wrong correct answer.
5. **Fix a wrong answer key.** If a question turns out to have a wrong correct answer, the admin edits it and presses **Re-score question N**. All attempts for that question are re-evaluated (needs the stored `AnswerValue` and `ElapsedMs`, which is why both are saved), then totals are recalculated.
6. **Recap** (see 15).

---

## 14. Configuration

### 14.1 `src/config.js` (public values only; safe to commit)
```js
export const config = {
  clientId: '<existing SPA registration client id>',
  tenantId: '<tenant id>',
  redirectUri: window.location.origin,
  loginScopes: ['User.Read'],
};
```

### 14.2 Vercel environment variables (secrets; never committed)
```
TENANT_ID=
API_CLIENT_ID=          # Registration B
API_CLIENT_SECRET=      # Registration B
SITE_ID=                # Graph site id of Julequiz2026
LIST_QUESTIONS_ID=
LIST_ATTEMPTS_ID=
LIST_TOTALS_ID=
LIST_SETTINGS_ID=
ADMIN_USER_IDS=id1,id2
CRON_SECRET=
NOW_OVERRIDE=           # preview/dev only
```

### 14.3 Repo hygiene (lessons from the World Cup app)
- `.gitignore` must contain `node_modules`, `.env*`, `dist` **from the first commit**. Committed `node_modules` previously caused Vercel build cache corruption.
- Keep secrets only in Vercel env vars, so there is no "never overwrite config.js" problem: `config.js` holds only public IDs.
- Suggested new repo: `christmas-quiz`.

---

## 15. Optional modules (feature-flagged, default off)

Each is independent and can be added after the core works.

1. **Streak bonus** (`FEATURE_STREAK`). Bonus points for consecutive correct answers in question order, e.g. +50 per step, capped at +250.
2. **Norway vs Denmark** (`FEATURE_OFFICE`). Ask for office on first login (stored in `QuizTotals`). Show average points **per participant** per office (not the sum, so office size does not decide it) on the leaderboard page.
3. **Teams reminder.** A Power Automate flow (or a cron-triggered function) posts a daily message to the Teams channel at 08:00 with a link to the app. This is probably the single most effective feature for participation.
4. **Final recap page** (admin-generated, for the Christmas party or the AI channel): winner, podium, fastest average answerer, toughest question (lowest share correct), most-missed question, most popular wrong answer, participation rate per day.
5. **Per-question statistics** shown to players after the reveal: "62% answered correctly".

---

## 16. Edge cases and rules

| Situation | Behaviour |
|---|---|
| User presses Start and closes the app | Attempt stays `started`; on return the question resumes with the remaining time; once the deadline passes it becomes `expired` (0 points) |
| User opens the question in two tabs | Same attempt, same deadline; the first answer wins (ETag), the second gets 409 |
| Answer arrives after limit + grace | `expired`, 0 points |
| Locked question requested directly via the API | 403 `locked` |
| Quiz closed (after `CLOSE_DATE`) | No new starts or answers; leaderboards and review remain available |
| New user joins on day 20 | Sees doors 1-20 available, all playable |
| User answers question 5 on day 20 | `OnTheDay=false`; `LateMultiplier` applied (default 1.0) |
| Two admins edit the same question | Last save wins; show "updated by X at ..." in the admin list |
| Wrong answer key discovered | Admin edits and uses Re-score (section 13.5) |
| Graph/SharePoint throttling (429) | Retry with `Retry-After`, max 3 times, then a friendly error |
| Display name changes | Refreshed on each login in `QuizTotals` |
| Daylight saving | Not relevant in December; the date logic still uses `Europe/Oslo` for correctness |

---

## 17. Build order for Claude Code

1. Scaffold Vite + React 18 + Tailwind, `.gitignore`, Vercel project; deploy a hello-world to confirm the pipeline. Add the new redirect URI to Registration A.
2. MSAL redirect login, `/api/me` with Graph `/me` verification and in-memory token cache.
3. Create Registration B and the SharePoint site and lists (section 5); grant `Sites.Selected`; write the small Graph helper in `/api/_lib/graph.js` (token acquisition via client credentials, paging, ETag, 429 retry).
4. `/api/admin/questions` CRUD and a minimal admin question editor; add 3-4 test questions.
5. `GET /api/questions`, `start`, `answer` with scoring (unit-test `speedPoints`, estimate accuracy, shuffle determinism, date helpers, and unlock logic with `NOW_OVERRIDE`).
6. Advent-calendar home, question flow (ready / live / result), image preloading.
7. Totals update, `/api/leaderboard` (total and per question), leaderboard UI.
8. Reveal logic, "My answers", About page.
9. Admin: settings, attempts overview, recalc, re-score.
10. Cron snapshot, badges (mover, spoon).
11. Polish: Christmas theme, snow, confetti, reduced-motion, mobile QA on iOS Safari and Android Chrome.
12. Load test with about 150 simulated users answering within the same minute (the 09:00 rush); check Graph throttling behaviour.
13. Dry run: set `NOW_OVERRIDE` to 1 December, then 20 December, and test with 3-5 colleagues before launch.
14. Add the 24 real questions; announce.

---

## 18. Testing checklist

- [ ] Sign in works on desktop and on phones (iOS Safari, Android Chrome) with the redirect flow
- [ ] A locked question cannot be fetched or started, even by calling the API directly
- [ ] Correct answers do not appear in any network response before the reveal
- [ ] Option order differs between two test users and is stable across reloads for the same user
- [ ] Double-tap and two-tab submits score only once
- [ ] Answer at 0 s gives about 1000 points; at 30 s about 500; after limit + grace gives 0
- [ ] Reload during a live question resumes with the correct remaining time
- [ ] New user at "20 December" can play questions 1-20 in any order
- [ ] Per-question leaderboard hidden until the user has answered that question
- [ ] Tie-breaking order verified with crafted data
- [ ] Re-score and Recalculate give identical totals
- [ ] Throttling (429) handled without lost or double writes
- [ ] No secrets in the repository or the client bundle

---

## 19. Open decisions (defaults will be used if not changed)

| # | Decision | Default |
|---|---|---|
| 1 | UI language | Norwegian Bokmål |
| 2 | Late-play multiplier | 1.0 (no penalty); can be changed any time |
| 3 | Correct answers revealed | After `CLOSE_DATE` (31 Dec) |
| 4 | Daily leaderboard meaning | Per question, visible only after you have answered |
| 5 | Close date | 31 December 2026 |
| 6 | Optional modules (streak, office battle, Teams reminder, recap) | Off until the core is live |
| 7 | Separate Azure registration for the API | Yes (Registration B with `Sites.Selected`) |
