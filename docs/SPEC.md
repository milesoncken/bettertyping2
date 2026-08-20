# bettertyping 2 — Product & Architecture Spec

> Status: **being built**. Stages 0–6 have landed; see the delivery plan in §10
> for what each one actually shipped and where it differed from this document.

---

## 0. What we decided

| Decision | Choice |
|---|---|
| Scope | Full-stack rewrite, monorepo in this repo. `master` untouched until merge. |
| Frontend | React 19 + TypeScript (strict) + Vite, SPA |
| Backend | Node + TypeScript + Fastify |
| Database | Postgres + Drizzle ORM. **Clean slate** — no migration. |
| Results integrity | Server replays every submission and recomputes results. |
| Auth | Google OAuth (PKCE). Discord deferred. Guest play, unranked. |
| Modes (v1) | time, words, + punctuation / numbers modifiers |
| Coaching | Deterministic analytics → generated drills. No LLM. |
| Mobile | Fully responsive site; the **test itself is desktop-only** by design. |
| Motion | Signature-but-calm during a test. Spectacle around it. |
| Render tech | WebGL on showcase surfaces only. Never on the test screen. |
| Theming | One signature art direction + ~6 hand-authored variants. |
| Audio | Switch profiles + results swell. Off by default. |
| Curriculum | Adaptive drills, XP / levels / streaks, daily challenge. |
| Hosting | Render (static site + web service + Postgres) |
| Brand | Name stays `bettertyping`. New wordmark, type system, motion identity. |

Explicitly **out of v1**: multiplayer racing, quotes/passages, custom text, code mode, zen mode, LLM coaching, mobile typing.

---

## 1. What was actually wrong with v1

Recorded so the rewrite is judged against real defects, not vibes.

**Architectural**
1. **State lives in the DOM.** `TextArea.jsx` mutates `document.getElementsByClassName("letter")[i].classList`. React renders a shell around imperative DOM writes. Every downstream feature inherits that fragility.
2. **Line wrapping via `getBoundingClientRect()` comparisons**, scrolled with negative margins. Layout-dependent, resize-fragile, unmeasurable.
3. **Word data stored as React elements in state** (`setWordList(elements)`) — view and model conflated.
4. **Numeric state machine** (`-1, 0, 1, 3, 4, 5`, no `2`) coordinated across ~13 `useEffect`s in two components, with a code comment reading *"weird things happen (its sent twice)... i have no idea awhy"*.
5. `window.location.reload()` as a restart mechanism.
6. No TypeScript in app code. No tests. No CI.

**Correctness**
7. **Accuracy never forgives a correction.** Backspace clears CSS classes and decrements the index but never pops `currentCorrectLetterArray` / `currentIncorrectLetterArray`. Fixing a typo charges you for the error *and* the correction, permanently.
8. **`trueWPM = (correct − incorrect) / 5 / min`** double-penalizes errors, can go negative, and is comparable to no other site.
9. **Chart data is sampled by a live `setInterval`**, so results are non-reproducible and cannot be verified server-side.
10. **Timing uses `Date.now()`** — wall clock, subject to NTP jumps and lower resolution than the monotonic clock.
11. Test ends via `letters.length === currentLetterIndex + 2`; the final character is never evaluated on its own terms.
12. `currentLetter.textContent` is dereferenced without a null guard.
13. `App.jsx` reads `error.response.data` unconditionally — any network error throws inside the catch.

**Product / integrity**
14. **The leaderboard is forgeable.** The client computes `results`, sets `isValid` itself, sends the word list it claims it typed, and POSTs the whole object. One `curl` takes rank 1.
15. **Difficulty is dead code.** 646 lines of easy/hard word lists with no UI path; `difficulty` is hardcoded `"normal"` in the reset.
16. **Heatmap "slowness" is each key's single worst keystroke** — that is noise, not signal.
17. Analysis page renders `JSON.stringify(analysisJson)` at 10px.
18. No punctuation, numbers, themes, keyboard shortcuts, or mobile support.

---

## 2. Repository architecture

```
bettertyping2/
├── apps/
│   ├── web/                 React + TS + Vite SPA
│   └── api/                 Fastify + TS
├── packages/
│   ├── engine/              Typing engine. Pure TS. Zero deps. No DOM, no React.
│   ├── metrics/             WPM / accuracy / consistency. Shared client + server.
│   ├── analytics/           Keyboard geometry, bigrams, error taxonomy, rollups.
│   ├── schema/              Drizzle schema + Zod contracts + shared types.
│   └── ui/                  Design tokens, primitives, motion system.
├── docs/
└── ...
```

**The linchpin:** `packages/engine` and `packages/metrics` are imported by *both* the browser and the server. The same code that scores your test in the UI is the code that verifies it on submission. Client and server cannot disagree for an honest player — and a dishonest one has to defeat a deterministic replay of their own keystrokes.

Tooling: pnpm workspaces · TypeScript strict · Vitest (unit) · Playwright (e2e) · ESLint + Prettier · GitHub Actions CI (typecheck, lint, test, build on every PR).

---

## 3. The typing engine (`packages/engine`)

A pure reducer. No DOM access, no React, no timers. React subscribes to it; it never subscribes to React.

```ts
type Phase = 'idle' | 'ready' | 'running' | 'finished';

interface EngineState {
  phase: Phase;
  words: Word[];            // { target: string; typed: string[]; extra: string[] }
  cursor: { word: number; char: number };
  events: KeyEvent[];       // append-only, monotonic
  startedAt: number | null; // performance.now() origin
}

interface KeyEvent {
  t: number;                // ms since first keystroke, float, monotonic
  code: string;             // physical key — layout independent
  key: string;              // produced character
  hold?: number;            // keyup − keydown
  target: string | null;    // expected char at the time
  kind: 'char' | 'backspace' | 'word-back' | 'space';
}
```

**Named phases replace magic numbers.** Transitions are explicit and exhaustively typed.

**Timing** comes from the DOM event's own `timeStamp` where available (hardware-stamped, lowest jitter), falling back to `performance.now()`. Never `Date.now()`.

**Rules v1 gets right that v1 got wrong**
- Backspace genuinely reverts state; correctness is *derived* from the event log, never accumulated in mutable arrays.
- **Two accuracy figures, both reported:** `firstAttemptAccuracy` (was it right the first time — the comparable industry metric) and `finalAccuracy` (was the submitted text correct). Corrections count against the first, not against WPM.
- **Extra characters supported** — typing past a word's length appends marked-extra glyphs rather than silently advancing.
- **Space skips the word**, marking the remainder missed.
- Backspace across a word boundary is permitted only into words containing an error (`freedomMode` setting relaxes this).
- `ctrl/alt+backspace` deletes a whole word.
- Auto-repeat keydowns are discarded, not double-counted.
- Paste, IME composition, and non-producing modifiers are rejected at the boundary and never reach the engine.

**Rendering contract:** the engine emits state; the view renders it. Character status is a value in state, never a class added to a DOM node. Line layout is computed from a measured character grid, not from `getBoundingClientRect()` diffing.

---

## 4. Metrics (`packages/metrics`) — canonical definitions

All derived from the event log **after the fact**, deterministically. Nothing sampled live.

| Metric | Definition |
|---|---|
| `rawWpm` | `(allTypedChars / 5) / minutes` |
| `wpm` | `(correctChars / 5) / minutes` — net WPM. **No error subtraction.** |
| `accuracy` | `correctKeystrokes / totalKeystrokes` (first attempt) |
| `consistency` | `100 × (1 − σ/μ)` over per-second WPM samples |
| `charStats` | `correct / incorrect / extra / missed` |

Per-second samples are **reconstructed from the event log**, so the chart is a pure function of the keystrokes. This is what makes server verification possible at all — and it is exactly what v1 could not do.

---

## 5. Integrity pipeline

**Server owns the text.** The client requests a test; the server issues `{ testId, seed, mode, config, issuedAt }` and stores it. Word lists are generated from the seed by shared code. The client can no longer tell the server what it typed — only *how*.

On submission the server:

1. **Regenerates** the word list from the stored seed.
2. **Replays** the submitted event log through `packages/engine`.
3. **Recomputes** results via `packages/metrics` and compares to the client's claim. Mismatch → reject.
4. **Runs integrity checks:**
   - timestamps monotonic; total duration consistent with server-side `issuedAt → receivedAt`
   - keydown/keyup pairing; hold-time distribution within human range
   - inter-keystroke intervals: no sub-human minimum, no sustained impossible bursts
   - **coefficient-of-variation floor** — humans are never *that* regular; scripts are
   - same-finger bigram timings must exceed physical minimums
   - per-user and per-IP submission rate limits
5. **Bands by score.** Results above a high-water threshold enter `flagged` and require passing a stricter statistical review before appearing publicly.
6. Persists `verification: 'verified' | 'flagged' | 'rejected'` plus the reason.

Leaderboards read `verified` only. Guest tests never reach a leaderboard.

---

## 6. Data model (sketch)

`users` · `oauth_accounts` · `sessions` · `tests` · `personal_bests` · `key_stats` · `bigram_stats` · `daily_challenges` · `daily_results` · `user_progress` · `drills` · `achievements`

- Raw event logs stored compressed as `jsonb` on `tests` (moved to object storage if volume demands).
- `key_stats` / `bigram_stats` updated incrementally per verified test, so the analytics dashboard never scans raw logs.
- Leaderboards: partial indexes on `(mode, length, wpm DESC) WHERE verification = 'verified'`, plus rolling daily/weekly aggregate tables.

---

## 7. Analytics & coaching (`packages/analytics`)

Everything below is computed, not guessed. No model calls.

- **Per key:** median latency, miss rate, sample count. *(Median — not v1's "worst single keystroke".)*
- **Per bigram:** transition latency. This is the real signal: `th` is fast, `yp` is slow, and your slow set is personal.
- **Error taxonomy:** substitution (and whether the wrong key was physically adjacent), transposition (rolled out of order), insertion, omission, capitalisation.
- **Biomechanics:** hand balance, finger load, same-finger bigram frequency, alternation ratio.
- **Rhythm:** warm-up curve, fatigue decay across a test, consistency over time.
- **Weakness ranking → drill generation:** synthesize word lists weighted toward your worst bigrams, drawn from real dictionary words so drills read as English rather than gibberish.

This is the pillar's entire justification: no other site keeps per-keystroke timing at this fidelity, so no other site can do this.

### What Stage 6 settled

**Everything is keyed on the physical key.** `KeyboardEvent.code`, never the
character. A claim about fingers, hands or rolls is only true if it is made about
position — so the Atlas is the board under your hands whatever layout is mapped
onto it.

**Layouts are observed, not configured.** Every keystroke is a `(code, key)`
pair, and a *wrong* key is evidence too, since it still printed what it prints.
So the character each key produces is learned from the player's own log and
stored on the rollup row. A Dvorak player gets a Dvorak Atlas with no table
shipped for it and no settings toggle to get wrong. Where a needed character has
never been typed, a QWERTY guess fills in — but only when the keys already seen
agree with QWERTY, so the guess is never applied to someone it would be wrong
about.

**Dwell is separated from flight.** `flight` is the gap since the previous key
went down — the cost of *getting to* a key. `dwell` is how long it stayed down.
Two players at the same speed can have opposite profiles, and neither number is
visible in a WPM figure. Dwell is captured on `keyup` into a side-channel map and
merged into the log once, after the run: nothing re-renders on a key release,
because the test screen's claim is a keystroke painting in one frame.

**Medians do not merge, so rollups store the mean of per-run medians.** Not a
running mean over raw samples, which would hand one thirty-second pause the power
to redefine a key. Each run's median has already discarded that run's outliers,
and their mean merges by addition — which is all a `SET x = x + excluded.x`
upsert can do. Two runs submitted at once therefore cannot lose an update to each
other the way a read-modify-write would.

**A pause is not a transition.** Gaps over 1.5 s are left out of every latency
median while the pair is still counted. Someone glancing away mid-run should not
have that second charged to the `he` bigram.

**A correction breaks the bigram chain.** Pairs are taken from adjacent entries in
the raw log, so a backspace between two characters ends the run of them. The time
to type `e` after fixing a mistake is the cost of the correction, not of the
movement, and averaging the two hides both.

**Sample counts travel with every figure.** A key or pair below eight
observations is drawn as *unmeasured* rather than given a colour it has not
earned — the difference between "average" and "we do not know".

**Deferred to Stage 7.** Drill generation, and the forecast model that Stage 3
promised would replace the within-run ±1σ band. The band's source still has to
change and its drawing code still does not.

---

## 8. Design

**Art direction: E1 — Telemetry.** Locked. Specimens in `docs/art-directions-2.html`.

### The governing rule

**The interface is monochrome. Colour belongs exclusively to data.**

The spectral ramp — magenta through indigo to ice — encodes speed, and appears
only on the trace, the caret, the heatmap and data marks. It never touches a
background, a button, a heading or a border. This single discipline is what
separates "scientific instrument" from "video game HUD", and it keeps every
future screen on-identity without re-deciding.

### Tokens

| Role | Value |
|---|---|
| ground | `#06080C` |
| rule | `#161C24` |
| rule (active) | `#3A4759` |
| text | `#E7EEF7` |
| text dim | `#5B6B80` |
| data — fast | `#35E8FF` |
| data — mid | `#7A6BFF` |
| data — slow / error | `#FF3DB8` |

### Type

| Role | Face |
|---|---|
| Labels, identifiers, units, large numerals | **IBM Plex Sans Condensed 700**, uppercase, wide tracking |
| Readouts and probabilities | **Azeret Mono** |
| Test text | **IBM Plex Mono** — chosen purely for legibility at speed |

Chrome: hairline frame with corner registration marks, a calibration rail on the
measurement axis, dense micro-typography. Six variants remain hand-authored art
directions rather than palette swaps, all obeying the governing rule.

### The signature interaction — The Line

- **During the test:** a spectral trace beneath the text, hue driven by
  instantaneous speed, with keystroke event marks ticking along its baseline.
  One canvas path, raw `requestAnimationFrame`, no library.
- **At the finish:** the trace detaches, scales, and settles into the results
  chart in one continuous transition. The chart was never generated — you drew it.
- **Ever after:** every test in your history is a Line; your best one is lit.
  Racing your past self is two Lines drawn at once.

### E3 "Machine Vision" — inventory

These ideas are **kept**, moved off the live test screen and into the surfaces
where the player is reading rather than typing. Recorded here explicitly so they
survive the gap between design and implementation.

| Idea | Lands in | Stage |
|---|---|---|
| Confidence band (±1σ) around the trace | Results chart, history charts | 3, 5 |
| Beating the forecast — trace leaving the band | Results reveal, as the celebrated moment | 3 |
| Bigram risk rail with probability bars | Analytics dashboard; test **ready** state | 6 |
| Detection boxes on words | Ready state only; fade on first keystroke | 2 |
| Reticle on the active word | Persists during typing — the one annotation that stays | 2 |
| Per-word latency prediction tags | Results review and replay scrubbing | 3, 5 |
| `obs N · conf 0.93` model header | Analytics dashboard header | 6 |

**Deferred out of Stage 5.** Per-word latency prediction tags and replay
scrubbing are listed above against stages 3 and 5 and have landed in neither.
Both want per-word timing models, which is the analytics engine's job — they move
to Stage 6 rather than being approximated now. The band itself did land on the
history charts, from the same function the Line uses.

**Cold start.** Forecasts need roughly 10–20 completed tests before they mean
anything. Every forecast surface therefore needs a designed empty state that
reports how many tests remain before predictions unlock — not a blank rail.

**Rules of engagement for motion**

- Nothing animates behind text while a key can be pressed.
- The test route ships no WebGL and no motion library.
- WebGL is lazy-loaded on landing, results backdrop and analytics only, each
  with a static fallback.
- `prefers-reduced-motion` is a first-class path, not a disable switch.

### Performance budget

| Target | Budget |
|---|---|
| Keystroke → paint | **one frame** — p99 ≤ 17 ms at 60 Hz |
| Test route JS | < 100 KB gzip |
| LCP (landing) | < 1.5 s |
| Dropped frames during a test | zero |

## 9. Screens

1. **Landing + Test** — one page. The test is playable immediately; the spectacle lives above and behind it.
2. **Results** — a transition, not a route.
3. **Profile / analytics dashboard** — heatmap, bigram table, error taxonomy, trend lines.
4. **Leaderboards** — all-time / weekly / daily, per mode and length.
5. **Training** — adaptive drills and progression.
6. **Daily challenge** — same test for everyone, 24-hour board.
7. **Settings** — full surface, mirrored in the command palette.
8. **Account** — OAuth, guest claim, data export, delete.

---

## 10. Delivery plan — one PR per stage

| Stage | Contents | Exit criteria |
|---|---|---|
| **0** | Monorepo, pnpm workspaces, TS strict, CI, design tokens | CI green on an empty app |
| **1** | `engine` + `metrics`, headless, unit-tested, golden keystroke-log fixtures | Replay determinism proven by test |
| **2** | Test screen + the Line, keyboard-first, no backend | Feels perfect offline; p99 input latency measured |
| **3** | Results transition, spectacle layer, WebGL surfaces, audio | The moment lands |
| **4** | Fastify API, Drizzle schema, OAuth, issuance + submission + verification | A forged submission is rejected in a test |
| **5** | Leaderboards, profiles, history | Real data end to end |
| **6** | Analytics engine + dashboard + heatmap done properly | Insights are correct and legible |
| **7** | Adaptive drills, XP / levels / streaks, daily challenge | Retention loop closed |
| **8** | Six variants, settings, perf budget enforcement, a11y audit, launch | Ship |

**Landed:** Stages 0 through 6.

- **0** — monorepo, strict TS, CI, lint. v1 app moved to `legacy/`, since deleted.
- **1** — `engine` + `metrics`, 30 tests, replay determinism proven.
- **2** — `apps/web`: test screen, the Line, results. Measured in Chromium at
  **p50 8.5 ms / p99 15.4 ms** keystroke-to-paint, **68 KB gzip** against a 100 KB
  budget.
- **3** — the signature moment: the trace detaches and flies into the results
  chart, E3's ±1σ confidence band, synthesised switch audio, and the lazy WebGL
  results backdrop. Test route **71 KB gzip**; the shader is a separate 1.4 KB
  chunk the test route never loads.

- **4** — `apps/api` (Fastify), `packages/schema` (Drizzle + Zod),
  `packages/verify`. Google OAuth with PKCE, sessions, test issuance and
  server-replayed submission. 60 tests, including a full integration suite
  against real Postgres via PGlite with the committed migration applied. Setup in
  [`BACKEND.md`](BACKEND.md).

- **5** — the read side: `/leaderboards`, `/u/:username`, `/me` and `/run/:id`,
  behind a 91-line router and a single lazy chunk. 81 tests, 18 of them for the
  read side. `legacy/` is deleted, which was this stage's stated condition — the
  v1 app no longer does anything the rewrite does not.

- **6** — `packages/analytics`, the `key_stats` / `bigram_stats` rollups, and the
  `/analysis` observatory: the Rhythm Ribbon, the Atlas and the Transition Rose.
  **Dwell capture landed with it** — `hold` had been declared in the engine, the
  wire contract and the verifier since Stage 4, and never once written, because
  the app bound only `keydown`. 126 tests. Test route **73.4 KB gzip** against
  the 100 KB budget, +0.28 KB over the branch point.

**What a board is, and why.** A board is a **(mode, length)** pair. Modifiers are
a difficulty a player chooses, not a category: splitting boards by punctuation
and numbers would quarter the population on every board and hand anyone willing
to pick an unpopular combination a rank they did not earn. Each row reports its
own modifiers instead. One row per player — their best — via `DISTINCT ON`, and
`verification = 'verified'` is the only population any board, profile figure or
trend line is computed over. A guest run cannot rank because there is nobody to
attribute it to, not because a policy check rejects it.

**A run is re-derivable, so it is auditable.** `/run/:id` does not read a stored
chart. It joins the run to the issuance that produced it, replays the keystroke
log through the same engine the browser ran, and recomputes the samples on
request. Every row on a leaderboard therefore links to the evidence behind it,
and the evidence is the thing the verifier judged rather than a second copy of
the truth that can drift from it. Verified runs are public for that reason; a
held or rejected run is visible only to the person who typed it.

**Your own history tells you the truth about itself.** A flagged run appears in
your history labelled *held*, a rejected one *not counted*. v1 let the client
decide `isValid` and the board believed it; the opposite failure — a server that
silently discards runs and never says so — would be its own kind of dishonest.

**Confidence band, honestly scoped.** In Stage 3 the band is ±1σ of the player's
own rhythm *within the run* — a centred rolling mean and standard deviation of
their speed. It needs no history, so it works on a first visit, and the dots mark
where they broke their own pattern. Stage 6 swaps the source for a model fitted
across a player's history; the drawing code does not change. The cold-start
state E3 requires is therefore already solved: there is never an empty band.

**A note on the latency budget.** The original "< 16 ms p99" was measuring the
wrong thing: at 60 Hz the floor is one vsync interval, so a keystroke landing
mid-frame can only paint 0–17 ms later. The budget is therefore *one frame* —
a p99 near 17 ms means every keystroke painted at the next possible opportunity,
which is optimal, not marginal.

---

## 11. Open questions

1. ~~Typeface~~ — settled by the art direction: IBM Plex Sans Condensed / Azeret Mono / IBM Plex Mono.
2. ~~Accent colour~~ — settled: spectral data ramp, monochrome interface.
3. **References** — still useful. Name three sites whose *feel* you envy.
4. Do you already have Google / Discord OAuth applications registered?
5. Any budget for a licensed typeface, or open-source only?
6. Domain — staying put, or moving?
