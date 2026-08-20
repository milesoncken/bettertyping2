import { apiGet } from "../lib/api.js";
import type {
  BoardWindow,
  HistoryResponse,
  LeaderboardResponse,
  ProfileResponse,
  RunResponse,
} from "@bettertyping/schema/contracts";

/**
 * The read side, from the browser.
 *
 * Every import from `@bettertyping/schema` here is `import type` and must stay
 * that way: the package pulls in Zod and Drizzle at runtime, and neither has any
 * business in a browser bundle. Types are erased at compile time, so the wire
 * contract is shared with the server at zero cost.
 */

export type {
  BoardWindow,
  HistoryEntry,
  HistoryResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  PersonalBestEntry,
  ProfileResponse,
  RunResponse,
} from "@bettertyping/schema/contracts";

/** Mirrors the server's board set. Duplicated rather than value-imported. */
export const DURATIONS = [15, 30, 60] as const;
export const WORD_COUNTS = [25, 50, 100] as const;
export const WINDOWS: readonly BoardWindow[] = ["daily", "weekly", "all"];

export const fetchLeaderboard = (
  mode: "time" | "words",
  length: number,
  window: BoardWindow,
): Promise<LeaderboardResponse> =>
  apiGet<LeaderboardResponse>(`/leaderboard?mode=${mode}&length=${length}&window=${window}`);

export const fetchHistory = (cursor?: string | null): Promise<HistoryResponse> =>
  apiGet<HistoryResponse>(
    `/me/history?limit=25${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
  );

export const fetchProfile = (username: string): Promise<ProfileResponse> =>
  apiGet<ProfileResponse>(`/users/${encodeURIComponent(username)}`);

export const fetchRun = (id: string): Promise<RunResponse> =>
  apiGet<RunResponse>(`/tests/${encodeURIComponent(id)}`);

/** A run's mode and length, the way every screen writes it. */
export const boardLabel = (mode: string, length: number): string =>
  mode === "time" ? `time ${length}` : `words ${length}`;

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const fullDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
