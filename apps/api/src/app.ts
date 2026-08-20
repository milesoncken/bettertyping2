import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Env } from "./env.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerTestRoutes } from "./routes/tests.js";

export interface BuildOptions {
  db: Db;
  env: Env;
  /** Injected in tests so the OAuth callback never reaches the network. */
  fetchImpl?: typeof fetch;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.env.NODE_ENV !== "test",
    // The browser is the only client; a big body means a long keystroke log.
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(cookie, { secret: options.env.SESSION_SECRET });
  await app.register(cors, {
    origin: options.env.WEB_ORIGIN,
    // Sessions ride on a cookie, so the browser must be allowed to send it.
    credentials: true,
  });

  app.get("/health", async () => ({ ok: true }));

  registerAuthRoutes(app, {
    db: options.db,
    env: options.env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  registerTestRoutes(app, options.db);

  return app;
}
