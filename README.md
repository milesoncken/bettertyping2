# bettertyping – a sleek, modern typing platform  

a minimalist typing test site built by alan reyes and miles oncken. it offers multiple test modes, progress tracking, and interactive stats to help users improve speed and accuracy.  

## features
- multiple test modes
- detailed test history and performance tracking  
- leaderboards to compete with friends and the community  
- replays to review typing sessions  
- interactive graphs and visualizations  

## tech stack
- frontend: react + vite  
- backend: node.js, express.js, mongodb  
- deployment: railway  

## license 📄  
mit license. see the license file for details. 

---

## bettertyping 2

A ground-up rewrite is in progress on `claude/bettertyping-2-redesign-s968ea`.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) — architecture, metric definitions, integrity pipeline, delivery plan
- **Art direction:** [`docs/art-directions-2.html`](docs/art-directions-2.html) — E1 "Telemetry" is locked
- **v1 app:** moved to [`legacy/`](legacy/), still runnable, deleted when `apps/web` lands

```bash
pnpm install
pnpm test        # engine + metrics
pnpm typecheck
pnpm lint
```

### Packages

| Package | Purpose |
|---|---|
| `packages/engine` | Pure TypeScript typing engine. No DOM, no React, no timers. |
| `packages/metrics` | Canonical WPM / accuracy / consistency. Imported by client *and* server. |
| `packages/verify` | Submission verification: replay, then decide whether hands could have done it. |
| `packages/schema` | Drizzle tables, committed migrations, and the Zod wire contracts. |
| `apps/web` | React 19 + Vite. The test screen and the Line. |
| `apps/api` | Fastify. Google sign-in, test issuance, verified submission. |

Backend setup, including creating the Google OAuth application:
[`docs/BACKEND.md`](docs/BACKEND.md).
