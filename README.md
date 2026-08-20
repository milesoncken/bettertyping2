# bettertyping – a sleek, modern typing platform  

a minimalist typing test site built by alan reyes and miles oncken. it offers multiple test modes, progress tracking, and interactive stats to help users improve speed and accuracy.  

## features
- multiple test modes
- detailed test history and performance tracking  
- leaderboards to compete with friends and the community  
- replays to review typing sessions  
- interactive graphs and visualizations  

## tech stack
- frontend: react 19 + typescript + vite  
- backend: node.js, fastify, postgres + drizzle  
- deployment: render  

## license 📄  
mit license. see the license file for details. 

---

## bettertyping 2

The ground-up rewrite. It is what this repository builds and deploys; the v1
app it replaced is gone from the tree and lives in the git history.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) — architecture, metric definitions, integrity pipeline, delivery plan
- **Art direction:** [`docs/art-directions-2.html`](docs/art-directions-2.html) — E1 "Telemetry" is locked
- **v1 app:** deleted. `apps/web` now carries history, leaderboards and profiles,
  which were the last things v1 still did that the rewrite did not. It is in the
  git history if it is ever wanted back.

```bash
pnpm install
pnpm test        # engine, metrics, verification, API integration
pnpm typecheck
pnpm lint

pnpm --filter @bettertyping/api dev:memory   # API on an in-process Postgres
VITE_API_URL=http://localhost:8099 pnpm dev  # the app, against it
```

The in-memory API stubs Google sign-in, so the whole signed-in loop — ranked
runs, boards, history — is playable locally with no database and no OAuth
application.

### Packages

| Package | Purpose |
|---|---|
| `packages/engine` | Pure TypeScript typing engine. No DOM, no React, no timers. |
| `packages/metrics` | Canonical WPM / accuracy / consistency. Imported by client *and* server. |
| `packages/analytics` | Keyboard geometry, per-key and per-bigram statistics, error taxonomy, rollups. |
| `packages/verify` | Submission verification: replay, then decide whether hands could have done it. |
| `packages/schema` | Drizzle tables, committed migrations, and the Zod wire contracts. |
| `apps/web` | React 19 + Vite. The test screen, the Line, and the board screens. |
| `apps/api` | Fastify. Google sign-in, test issuance, verified submission, boards. |

### Routes

| Route | What it is |
|---|---|
| `/` | The test. Never behind a dynamic import — it is the latency-critical path. |
| `/leaderboards` | Best verified run per player, per (mode, length), by day / week / all time. |
| `/me` | Your profile, plus your full history including runs that did not count. |
| `/u/:username` | Anyone's profile. Verified runs only. |
| `/run/:id` | One run, its chart recomputed on the server from the keystrokes it was verified against. |
| `/analysis` | The observatory — the Rhythm Ribbon, the Atlas and the Transition Rose. |
| `/analysis/:username` | Anyone's, over their verified runs. |

Backend setup, including creating the Google OAuth application:
[`docs/BACKEND.md`](docs/BACKEND.md).
