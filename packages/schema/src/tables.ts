import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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

/**
 * ─── Analytics rollups ──────────────────────────────────────────────────────
 *
 * The keystroke logs on `tests` are the evidence, and scanning them to draw a
 * dashboard would mean reading every run a player has ever done on every page
 * load. These two tables are the same information, folded forward on write.
 *
 * Both are keyed on the **physical key** rather than the character, because a
 * claim about fingers is only true if it is made about position. What each key
 * prints is carried alongside as `legend`, observed from the player's own log —
 * which means these tables record the player's layout as a side effect of
 * recording their typing, and cannot disagree with it.
 *
 * Latency is stored as a **sum of per-run medians with a count of runs**, not as
 * a sum of raw samples. Medians do not merge, and a mean over raw samples would
 * hand a single 30-second pause the power to redefine a key. Each run's median
 * has already discarded its own outliers, so their mean is robust and — the part
 * that matters here — mergeable by addition, which is all an upsert can do.
 */

export const keyStats = pgTable(
  "key_stats",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    /** The character this key produces on the player's board. */
    legend: text("legend").notNull().default(""),

    /** Times the key went down. */
    struck: integer("struck").notNull().default(0),
    /** Times it went down when a different key was wanted. */
    intruded: integer("intruded").notNull().default(0),
    /** Times the text asked for this key. */
    wanted: integer("wanted").notNull().default(0),
    /** Times it was asked for and something else arrived. */
    missed: integer("missed").notNull().default(0),

    flightSumMs: real("flight_sum_ms").notNull().default(0),
    flightRuns: integer("flight_runs").notNull().default(0),
    dwellSumMs: real("dwell_sum_ms").notNull().default(0),
    dwellRuns: integer("dwell_runs").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.code] })],
);

export const bigramStats = pgTable(
  "bigram_stats",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `${fromCode}>${toCode}`. */
    pair: text("pair").notNull(),
    fromCode: text("from_code").notNull(),
    toCode: text("to_code").notNull(),
    /** The two characters, for a label a human can read. */
    label: text("label").notNull().default(""),
    /** same-key | same-finger | in-roll | out-roll | alternate | thumb. */
    kind: text("kind").notNull(),

    n: integer("n").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    latencySumMs: real("latency_sum_ms").notNull().default(0),
    latencyRuns: integer("latency_runs").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.pair] }),
    // The dashboard wants a player's most-typed transitions, which is the only
    // way this table is ever read.
    index("bigram_stats_user_n_idx").on(table.userId, table.n),
  ],
);
