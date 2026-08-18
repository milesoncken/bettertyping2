import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { MeResponse } from "@bettertyping/schema";
import { schema } from "../db.js";
import type { Db } from "../db.js";
import type { Env } from "../env.js";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  pruneExpiredSessions,
  resolveSession,
  safeEqual,
} from "../auth/session.js";
import {
  authorizeUrl,
  createPkce,
  createState,
  exchangeCode,
  readIdToken,
  usernameFrom,
} from "../auth/google.js";

const STATE_COOKIE = "bt_oauth_state";
const VERIFIER_COOKIE = "bt_oauth_verifier";

export interface AuthDeps {
  db: Db;
  env: Env;
  /** Injectable so the callback can be tested without reaching Google. */
  fetchImpl?: typeof fetch;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { db, env } = deps;
  const secure = env.NODE_ENV === "production";

  // The state and verifier cookies are short-lived, signed, and cross-site by
  // necessity: the browser returns from Google via a top-level redirect, which
  // `lax` allows for a GET.
  const handshakeCookie = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
    signed: true,
  };

  app.get("/auth/google", async (_request, reply) => {
    const state = createState();
    const { verifier, challenge } = createPkce();

    return reply
      .setCookie(STATE_COOKIE, state, handshakeCookie)
      .setCookie(VERIFIER_COOKIE, verifier, handshakeCookie)
      .redirect(
        authorizeUrl({
          clientId: env.GOOGLE_CLIENT_ID,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          state,
          challenge,
        }),
      );
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      const failed = (reason: string): unknown =>
        reply.redirect(`${env.WEB_ORIGIN}/?auth=failed&reason=${reason}`);

      if (request.query.error) return failed("declined");

      const code = request.query.code;
      const returnedState = request.query.state;
      if (!code || !returnedState) return failed("missing_code");

      const expectedState = request.unsignCookie(request.cookies[STATE_COOKIE] ?? "");
      const verifier = request.unsignCookie(request.cookies[VERIFIER_COOKIE] ?? "");
      if (!expectedState.valid || !verifier.valid || !expectedState.value || !verifier.value) {
        return failed("bad_handshake");
      }
      // CSRF: the state we get back must be the state we set.
      if (!safeEqual(expectedState.value, returnedState)) return failed("state_mismatch");

      let identity;
      try {
        const exchange = await exchangeCode({
          code,
          verifier: verifier.value,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
        identity = readIdToken(exchange.idToken);
      } catch (error) {
        app.log.error({ err: error }, "google token exchange failed");
        return failed("exchange_failed");
      }

      if (!identity.emailVerified) return failed("email_unverified");

      const userId = await linkAccount(db, {
        sub: identity.sub,
        email: identity.email,
      });

      const { token, expiresAt } = await createSession(db, userId);
      void pruneExpiredSessions(db).catch(() => {
        // Housekeeping only; never fail a login over it.
      });

      return reply
        .clearCookie(STATE_COOKIE, { path: "/" })
        .clearCookie(VERIFIER_COOKIE, { path: "/" })
        .setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
          expires: expiresAt,
        })
        .redirect(`${env.WEB_ORIGIN}/?auth=ok`);
    },
  );

  app.get("/me", async (request, reply) => {
    const session = await resolveSession(db, request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "not_signed_in" });
    const body: MeResponse = { id: session.id, username: session.username };
    return reply.send(body);
  });

  app.post("/auth/logout", async (request, reply) => {
    await destroySession(db, request.cookies[SESSION_COOKIE]);
    return reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true });
  });
}

/**
 * Find or create the account behind a Google subject.
 *
 * Keyed on Google's `sub`, never on the email: people change their email and
 * emails get reassigned, but the subject is stable for the life of the account.
 */
async function linkAccount(
  db: Db,
  identity: { sub: string; email: string | null },
): Promise<string> {
  const existing = await db
    .select({ userId: schema.oauthAccounts.userId })
    .from(schema.oauthAccounts)
    .where(eq(schema.oauthAccounts.providerAccountId, identity.sub))
    .limit(1);

  const found = existing[0];
  if (found) return found.userId;

  const username = await uniqueUsername(db, usernameFrom(identity.email, identity.sub));

  const users = await db
    .insert(schema.users)
    .values({ username })
    .returning({ id: schema.users.id });

  const user = users[0];
  if (!user) throw new Error("Failed to create user");

  await db.insert(schema.oauthAccounts).values({
    userId: user.id,
    provider: "google",
    providerAccountId: identity.sub,
    email: identity.email,
  });

  return user.id;
}

async function uniqueUsername(db: Db, base: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 12)}${attempt}`;
    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, candidate))
      .limit(1);
    if (taken.length === 0) return candidate;
  }
  // Practically unreachable; a random tail is better than failing a sign-in.
  return `${base.slice(0, 10)}${Date.now().toString(36).slice(-5)}`;
}
