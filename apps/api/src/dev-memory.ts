import { createTestApp } from "./testing.js";

/**
 * The API against an ephemeral in-process Postgres.
 *
 * For working on the frontend without provisioning a database. Everything is
 * real except persistence — the same routes, the same migration, the same
 * verification — and it all vanishes when the process exits.
 *
 * Sign-in is stubbed: hitting /auth/google/callback signs you in as a fixed
 * local account, because a real Google handshake needs a registered OAuth app.
 */
const { app } = await createTestApp(
  (async () =>
    new Response(
      JSON.stringify({
        id_token: `header.${Buffer.from(
          JSON.stringify({
            sub: "local-dev-user",
            email: "local@bettertyping.dev",
            email_verified: true,
          }),
        ).toString("base64url")}.signature`,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch,
);

const port = Number(process.env["PORT"] ?? 8099);
await app.listen({ port, host: "127.0.0.1" });
process.stdout.write(`api (in-memory) listening on http://127.0.0.1:${port}\n`);
