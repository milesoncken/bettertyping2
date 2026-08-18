import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { buildApp } from "./app.js";
import { schema } from "./db.js";
import type { Db } from "./db.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool, { schema }) as unknown as Db;

const app = await buildApp({ db, env });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
