import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { applyKey, createState } from "@bettertyping/engine";
import type { EngineState, TestConfig } from "@bettertyping/engine";
import { buildApp } from "./app.js";
import { schema } from "./db.js";
import type { Db } from "./db.js";
import type { Env } from "./env.js";

/**
 * Test harness.
 *
 * The integration suite runs against a real Postgres — PGlite, in process — with
 * the committed migration applied. The SQL under test is the SQL that ships, and
 * no service has to be stood up to run it.
 */

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../packages/schema/migrations",
);

export const TEST_ENV: Env = {
  PORT: 0,
  NODE_ENV: "test",
  DATABASE_URL: "memory://",
  WEB_ORIGIN: process.env["WEB_ORIGIN"] ?? "http://localhost:5173",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:8080/auth/google/callback",
  SESSION_SECRET: "test-session-secret-that-is-long-enough-ok",
};

export interface TestHarness {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: Db;
  /** Empty every table. Far cheaper than standing up a fresh database per test. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApp(
  fetchImpl?: typeof fetch,
  /** Overrides for the cases where behaviour turns on configuration — `NODE_ENV`, say. */
  envOverrides?: Partial<Env>,
): Promise<TestHarness> {
  const client = new PGlite();
  // Every committed migration, in the same order the deploy applies them — so a
  // migration that is wrong is wrong in the suite too, rather than only in
  // production.
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit separates statements with a marker; PGlite runs them as a script.
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Db;
  const env: Env = { ...TEST_ENV, ...envOverrides };
  const app = await buildApp({ db, env, ...(fetchImpl ? { fetchImpl } : {}) });

  return {
    app,
    db,
    reset: async () => {
      await client.exec(
        "TRUNCATE users, oauth_accounts, sessions, issued_tests, tests, personal_bests, " +
          "key_stats, bigram_stats CASCADE",
      );
    },
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}

/**
 * Move an issuance back in time.
 *
 * A synthesized keystroke log describes minutes of typing that the test performs
 * in microseconds, so without this the verifier correctly rejects it for
 * claiming a duration longer than the window it was issued in. Backdating the
 * row is how the fixture says "the player really did take this long".
 */
export async function simulateElapsed(db: Db, testId: string, ms: number): Promise<void> {
  await db
    .update(schema.issuedTests)
    .set({ issuedAt: new Date(Date.now() - ms) })
    .where(eq(schema.issuedTests.id, testId));
}

/** Pull one cookie's value out of a set-cookie header list. */
export function cookieFrom(headers: unknown, name: string): string | null {
  const raw = Array.isArray(headers) ? headers : [String(headers ?? "")];
  for (const entry of raw) {
    const match = new RegExp(`(?:^|; |^)${name}=([^;]+)`).exec(String(entry));
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Type the text a seed produces, with a cadence that varies the way hands do.
 * A fixed interval would trip the verifier's own rhythm check.
 */
export const HUMAN_CADENCE = [88, 145, 102, 63, 197, 119, 74, 156, 91, 128, 210, 82];

/**
 * The physical key that types a character on ANSI QWERTY.
 *
 * Fixtures used to emit `Key_x`, which no keyboard has. That was invisible while
 * nothing read `code`; the analytics read nothing else, so a fixture that lies
 * about the board would exercise none of it.
 */
export function physicalCode(char: string): string {
  const named: Record<string, string> = {
    " ": "Space",
    ",": "Comma",
    ".": "Period",
    ";": "Semicolon",
    "'": "Quote",
    "/": "Slash",
    "-": "Minus",
    "=": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    "`": "Backquote",
  };
  if (named[char]) return named[char] as string;
  if (/^[a-zA-Z]$/.test(char)) return `Key${char.toUpperCase()}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  // Shifted punctuation shares its unshifted key; anything else is off-board.
  const shifted: Record<string, string> = {
    "!": "Digit1", "@": "Digit2", "#": "Digit3", "$": "Digit4", "%": "Digit5",
    "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0",
    "?": "Slash", ":": "Semicolon", '"': "Quote", "<": "Comma", ">": "Period",
  };
  return shifted[char] ?? "Unidentified";
}

export function playTest(
  config: TestConfig,
  options: {
    cadence?: readonly number[];
    chars?: number;
    fractional?: boolean;
    /** Set false to simulate a run recorded before dwell capture existed. */
    holds?: boolean;
  } = {},
): EngineState {
  const cadence = options.cadence ?? HUMAN_CADENCE;
  let state = createState(config);
  const full = state.words.map((w) => w.target).join(" ");
  const text = options.chars === undefined ? full : full.slice(0, options.chars);

  let t = 0;
  let i = 0;
  for (const char of text) {
    t += cadence[i % cadence.length]!;
    // A real browser's performance.now() is fractional. Whole-millisecond
    // fixtures hid a 500 where the duration column would not take a float.
    i += 1;
    state = applyKey(state, {
      key: char,
      code: physicalCode(char),
      t: options.fractional === true ? t + (i % 7) / 9 : t,
      // A hold that varies the way a hand does, so dwell has something real to
      // measure and the verifier's uniform-hold check has something to pass.
      ...(options.holds === false ? {} : { hold: 55 + (i % 5) * 9 }),
    });
  }
  return state;
}

/** A stand-in for Google's token endpoint. */
export function fakeGoogle(identity: { sub: string; email: string; verified?: boolean }): typeof fetch {
  const payload = Buffer.from(
    JSON.stringify({
      sub: identity.sub,
      email: identity.email,
      email_verified: identity.verified ?? true,
    }),
  ).toString("base64url");
  const idToken = `header.${payload}.signature`;

  return (async () =>
    new Response(JSON.stringify({ id_token: idToken }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}
