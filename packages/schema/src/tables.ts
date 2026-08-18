import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The database, as one file.
 *
 * Two things here are load-bearing for integrity rather than convenience:
 *
 *  - `issuedTests` exists because **the server owns the text**. A client asks
 *    for a test, the server records the seed it handed out, and a submission is
 *    checked against that row. The client cannot tell us what it typed, only how.
 *  - `consumedAt` makes an issuance single-use, so one good run cannot be
 *    submitted twice.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_username_key").on(table.username)],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_provider_account_key").on(table.provider, table.providerAccountId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    // The SHA-256 of the session token. The token itself is never stored, so a
    // leaked database cannot be used to impersonate anyone.
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const issuedTests = pgTable(
  "issued_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for a guest. A guest may play and see results; they cannot rank.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    seed: text("seed").notNull(),
    mode: text("mode").notNull(),
    duration: smallint("duration"),
    count: smallint("count"),
    punctuation: boolean("punctuation").notNull(),
    numbers: boolean("numbers").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    // Set on first submission. An issuance is single-use.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [index("issued_tests_user_idx").on(table.userId)],
);

export const tests = pgTable(
  "tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issuedTestId: uuid("issued_test_id")
      .notNull()
      .references(() => issuedTests.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),

    mode: text("mode").notNull(),
    // Seconds for time mode, word count for words mode. One column so the
    // leaderboard can index (mode, length, wpm) without a branch.
    length: smallint("length").notNull(),
    punctuation: boolean("punctuation").notNull(),
    numbers: boolean("numbers").notNull(),

    wpm: real("wpm").notNull(),
    rawWpm: real("raw_wpm").notNull(),
    accuracy: real("accuracy").notNull(),
    consistency: real("consistency").notNull(),
    durationMs: integer("duration_ms").notNull(),
    chars: jsonb("chars").notNull(),

    // 'verified' | 'flagged' | 'rejected'. Leaderboards read 'verified' only.
    verification: text("verification").notNull(),
    reasons: jsonb("reasons").notNull(),

    // The raw keystroke log. Every reported number is derived from this, so it
    // is the evidence as well as the input to the analytics engine.
    events: jsonb("events").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tests_issued_key").on(table.issuedTestId),
    index("tests_user_created_idx").on(table.userId, table.createdAt),
    // The leaderboard query. Partial, so rejected and flagged rows never enter
    // the index at all.
    index("tests_board_idx")
      .on(table.mode, table.length, table.wpm)
      .where(sql`${table.verification} = 'verified'`),
  ],
);

export const personalBests = pgTable(
  "personal_bests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    testId: uuid("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    length: smallint("length").notNull(),
    wpm: real("wpm").notNull(),
    achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("pb_user_mode_length_key").on(table.userId, table.mode, table.length)],
);
