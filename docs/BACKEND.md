# Backend setup

Everything needed to run the API locally and deploy it. Nothing here exists yet —
the Google OAuth application in particular has to be created before sign-in works.

---

## 1. Create the Google OAuth application

Sign-in is Google-only for now. Discord is deliberately deferred.

1. Go to <https://console.cloud.google.com/> and create a project — `bettertyping`.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name `bettertyping`, your email as support and developer contact
   - Scopes: add **`openid`** and **`.../auth/userinfo.email`** only. We ask for an
     identity, nothing else, and every extra scope is another thing to justify on
     the consent screen.
   - While the app is unpublished, only accounts added under **Test users** can
     sign in. Add your own. Publishing is a separate step and needs no review at
     this scope level.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorised redirect URIs** — these must match `GOOGLE_REDIRECT_URI`
     character for character, including the scheme and any trailing path:
     - `http://localhost:8080/auth/google/callback` (local)
     - `https://<your-api-host>/auth/google/callback` (deployed)
   - Authorised JavaScript origins are **not** needed: the browser never talks to
     Google directly, our server does.
4. Copy the **client ID** and **client secret**.

The secret is a real secret. It goes in the API's environment and nowhere near
the frontend bundle.

---

## 2. Environment

The API validates its environment at boot and refuses to start with a readable
error rather than failing later on someone's first sign-in.

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/bettertyping` | |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS origin and post-login redirect |
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` | |
| `GOOGLE_CLIENT_SECRET` | | Never in the frontend |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8080/auth/google/callback` | Must match the console exactly |
| `SESSION_SECRET` | 32+ random bytes | `openssl rand -base64 32` |
| `PORT` | `8080` | Render sets this itself |

The frontend takes one variable, `VITE_API_URL`. Leave it unset and the app runs
entirely offline — you can type, but runs cannot rank.

---

## 3. Local

```bash
# Postgres, however you like it
createdb bettertyping

cd apps/api
export DATABASE_URL=postgres://localhost/bettertyping
export WEB_ORIGIN=http://localhost:5173
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
export GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback
export SESSION_SECRET=$(openssl rand -base64 32)

pnpm migrate   # applies packages/schema/migrations in order
pnpm dev
```

Then, in another shell:

```bash
VITE_API_URL=http://localhost:8080 pnpm --filter @bettertyping/web dev
```

---

## 4. Migrations

Migrations are **generated, reviewed, and committed** — never generated at deploy
time. The SQL that runs in production is the same SQL the integration tests run
against.

```bash
# after changing packages/schema/src/tables.ts
npx drizzle-kit generate --name what_changed
# review packages/schema/migrations/*.sql, then commit it
```

`pnpm migrate` applies anything not yet recorded in the `_migrations` table, each
in its own transaction.

---

## 5. Deploying to Render

Two services and a database.

**Postgres** — create it first and copy the internal connection string.

**API** (Web Service, Node)
- Build: `corepack enable && pnpm install --frozen-lockfile`
- Start: `pnpm --filter @bettertyping/api migrate && pnpm --filter @bettertyping/api start`
- Environment: everything from the table above, with `GOOGLE_REDIRECT_URI` and
  `WEB_ORIGIN` pointing at the deployed hosts.

**Web** (Static Site)
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
- Publish directory: `apps/web/dist`
- Rewrite `/*` → `/index.html`
- Environment: `VITE_API_URL=https://<your-api-host>`

Cookies are `SameSite=Lax`, so the API and the web app should share a parent
domain in production (`bettertyping.app` and `api.bettertyping.app`). On entirely
unrelated domains the session cookie will be dropped by browsers that block
third-party cookies.

---

## 6. What the server actually enforces

Worth knowing before changing any of it. The rules live in
`packages/verify/src/index.ts`, with the thresholds gathered in one `LIMITS`
object so they can be argued about in one place.

- **The server owns the text.** A client asks for a test; the server picks the
  seed, stores it, and only accepts keystrokes replayed against the text that
  seed generates. A client cannot report *what* it typed, only *how*.
- **Every result is recomputed.** The submitted numbers are compared against the
  replay and a mismatch is a rejection. The stored result is always the server's.
- **An issuance is single use**, claimed before verification so a replayed
  request loses the race rather than producing a second row.
- **An issuance belongs to whoever it was handed to.** A guest's run cannot later
  be claimed by an account, and one account cannot submit another's.
- **Timing has to be human**: monotonic timestamps, a duration that fits inside
  the window it was issued in, no impossible intervals, and a coefficient of
  variation floor — people are not metronomes and scripts are.
- **Exceptional runs are flagged, not rejected**, and held out of the leaderboard
  pending a stricter review.

Where a rule is uncertain it flags rather than rejects. A false rejection costs a
real player their run and their trust; a false acceptance costs one flagged row
that a later review still catches.
