import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/schema/src/tables.ts",
  out: "./packages/schema/migrations",
  // Generation reads the TypeScript schema and needs no database. Migrations are
  // committed, reviewed, and are the same SQL that runs in tests and in
  // production — never generated at deploy time.
  verbose: true,
  strict: true,
});
