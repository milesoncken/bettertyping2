import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { schema } from "../db.js";
import type { Db } from "../db.js";

/**
 * Sessions.
 *
 * The cookie carries a random token; the database stores only its SHA-256. A
 * leaked database therefore cannot be used to impersonate anyone — there is
 * nothing in it to replay.
 */

export const SESSION_COOKIE = "bt_session";
const TTL_DAYS = 30;

const hash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface SessionUser {
  id: string;
  username: string;
}

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({ tokenHash: hash(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, hash(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return { id: row.id, username: row.username };
}

export async function destroySession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hash(token)));
}

/** Housekeeping. Cheap enough to run on a timer or after a login. */
export async function pruneExpiredSessions(db: Db): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}

/** Constant-time compare for the OAuth state cookie. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
