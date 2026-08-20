import type { TestConfig } from "@bettertyping/engine";

/**
 * The API client.
 *
 * Everything here degrades. If `VITE_API_URL` is unset, or the server is down,
 * the app generates its own seed and plays offline — the typing experience never
 * depends on the network. What you lose without a server is ranking, not typing.
 */

const BASE = import.meta.env["VITE_API_URL"] as string | undefined;

export const apiEnabled = (): boolean => typeof BASE === "string" && BASE.length > 0;

export interface IssuedTest {
  testId: string | null;
  seed: string;
}

export interface Me {
  id: string;
  username: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * A read of the API that reports its own failure.
 *
 * The test flow below swallows errors on purpose — typing must never wait on a
 * network. The board screens are the opposite: a leaderboard that silently
 * renders empty when the server is down is a lie, so this throws and lets the
 * screen say so.
 */
export async function apiGet<T>(path: string): Promise<T> {
  if (!apiEnabled()) throw new Error("no_api");
  return request<T>(path);
}

const localSeed = (): string => Math.random().toString(36).slice(2, 12);

/**
 * Ask the server for a test. The seed it returns is the one the submission will
 * be verified against, so the client never chooses its own text when ranked.
 */
export async function issueTest(config: {
  mode: "time" | "words";
  duration?: number;
  count?: number;
  punctuation: boolean;
  numbers: boolean;
}): Promise<IssuedTest> {
  if (!apiEnabled()) return { testId: null, seed: localSeed() };

  try {
    const body = await request<{ testId: string; seed: string }>("/tests/issue", {
      method: "POST",
      body: JSON.stringify(config),
    });
    return { testId: body.testId, seed: body.seed };
  } catch {
    // Offline, or the API is down. Play anyway; this run simply cannot rank.
    return { testId: null, seed: localSeed() };
  }
}

export interface SubmitOutcome {
  verification: "verified" | "flagged" | "rejected";
  reasons: string[];
  personalBest?: { previous: number | null; wpm: number };
}

export async function submitTest(
  testId: string,
  events: unknown[],
  claimed: { wpm: number; accuracy: number },
): Promise<SubmitOutcome | null> {
  if (!apiEnabled()) return null;
  try {
    return await request<SubmitOutcome>(`/tests/${testId}/submit`, {
      method: "POST",
      body: JSON.stringify({ events, claimed }),
    });
  } catch {
    return null;
  }
}

export async function fetchMe(): Promise<Me | null> {
  if (!apiEnabled()) return null;
  try {
    return await request<Me>("/me");
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  if (!apiEnabled()) return;
  try {
    await request("/auth/logout", { method: "POST" });
  } catch {
    // Nothing useful to do; the cookie expires on its own.
  }
}

export const signInUrl = (): string => `${BASE}/auth/google`;

/** The config the engine runs, given a server-issued seed. */
export function toEngineConfig(
  config: {
    mode: "time" | "words";
    duration?: number;
    count?: number;
    punctuation: boolean;
    numbers: boolean;
  },
  seed: string,
): TestConfig {
  return {
    mode: config.mode,
    seed,
    punctuation: config.punctuation,
    numbers: config.numbers,
    ...(config.duration !== undefined ? { duration: config.duration } : {}),
    ...(config.count !== undefined ? { count: config.count } : {}),
  };
}
