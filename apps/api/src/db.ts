import * as schema from "@bettertyping/schema";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * The database handle, as the app sees it.
 *
 * Typed against Drizzle's driver-agnostic base so the same routes run on
 * node-postgres in production and on PGlite in tests — the integration suite
 * exercises the real schema and the real SQL, with no service to stand up.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export { schema };
