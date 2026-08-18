# bettertyping 2 — Product & Architecture Spec

> Status: **draft for review**. Nothing below is built yet. Correct me before Stage 0 starts.

---

## 0. What we decided

| Decision | Choice |
|---|---|
| Scope | Full-stack rewrite, monorepo in this repo. `master` untouched until merge. |
| Frontend | React 19 + TypeScript (strict) + Vite, SPA |
| Backend | Node + TypeScript + Fastify |
| Database | Postgres + Drizzle ORM. **Clean slate** — no migration. |
| Results integrity | Server replays every submission and recomputes results. |
| Auth | Google + Discord OAuth. Guest play, results claimable on sign-in. |
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
│   ├── analytics/           Bigrams, error taxonomy, weakness ranking, drill generation.
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

- **Per key:** median latency, error rate, sample count. *(Median — not v1's "worst single keystroke".)*
- **Per bigram:** transition latency. This is the real signal: `th` is fast, `yp` is slow, and your slow set is personal.
- **Error taxonomy:** substitution (and whether the wrong key was physically adjacent), transposition (rolled out of order), insertion, omission, capitalisation.
- **Biomechanics:** hand balance, finger load, same-finger bigram frequency, alternation ratio.
- **Rhythm:** warm-up curve, fatigue decay across a test, consistency over time.
- **Weakness ranking → drill generation:** synthesize word lists weighted toward your worst bigrams, drawn from real dictionary words so drills read as English rather than gibberish.

This is the pillar's entire justification: no other site keeps per-keystroke timing at this fidelity, so no other site can do this.

---

## 8. Design

### Identity
Wordmark stays lowercase `bettertyping`, rebuilt around **the Line** — a single stroke that recurs everywhere: it is the caret, the WPM curve, the underline in the logo, the page transition, the progress bar, the leaderboard rank marker. One idea, expressed relentlessly. That repetition is what makes an identity read as designed rather than assembled.

### The signature interaction — The Line
- **During the test:** a thin luminous path is drawn beneath the text in real time. Its height is instantaneous WPM; its hue shifts subtly with accuracy. One animated path, Canvas2D. Costs nothing, distracts no one, and is quietly mesmerising.
- **At the finish:** the text dissolves upward and the Line *detaches*, scales, and settles into the results chart — one continuous transition, no cut, no route change. **The chart was never generated. You drew it.**
- **In history:** every test you have ever taken is a Line. Your history is a wall of them; your PB glows. Racing your best self is two Lines drawn at once.

### Rules of engagement for motion
- Nothing animates *behind* text while a key can be pressed.
- The test route ships **no WebGL and no motion library** — the Line is raw `requestAnimationFrame`.
- WebGL is lazy-loaded on landing, results backdrop, and analytics only, with static fallbacks.
- `prefers-reduced-motion` is a first-class path, not a disable switch.
- Every animation is interruptible. Nothing blocks input, ever.

### System
- **Type:** a monospace with genuine character for test text (JetBrains Mono / Commit Mono / Martian Mono — to select), paired with a display face for headings. Self-hosted, subset, preloaded.
- **Motion:** spring physics via `motion`; raw rAF for the Line. GSAP is dropped.
- **Variants (6):** hand-authored art directions, not palette swaps — Void, Paper, Terminal, Dusk, Solar, Ink.
- **Command palette (⌘K)** drives everything: mode, length, modifiers, theme, navigation. Tab+Enter restarts. The site is fully operable without the mouse.
- **Accessibility:** WCAG AA contrast in all six variants, screen-reader-coherent results, full keyboard navigation, honest focus states.

### Performance budget
| Target | Budget |
|---|---|
| Keystroke → paint | < 16 ms, p99 |
| Test route JS | < 100 KB gzip |
| LCP (landing) | < 1.5 s |
| Dropped frames during a test | zero |

---

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

---

## 11. Open questions

1. **Typeface** — preference, or shall I bring a shortlist with specimens?
2. **Accent colour** — do you have one, or do I propose the palette?
3. **References** — name three sites whose *feel* you envy. This calibrates my taste against yours faster than any adjective.
4. Do you already have Google / Discord OAuth applications registered?
5. Any budget for a licensed typeface, or open-source only?
6. Domain — staying put, or moving?
