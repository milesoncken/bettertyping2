import { z } from "zod";
import type { BigramStat, KeyStat, Keystroke, RollProfile } from "@bettertyping/analytics";

/**
 * The wire. Every request body is parsed through these, so a malformed or
 * hostile payload is rejected at the edge rather than deep inside the
 * verification pipeline.
 */

export const modeSchema = z.enum(["time", "words"]);

export const DURATIONS = [15, 30, 60] as const;
export const WORD_COUNTS = [25, 50, 100] as const;

/**
 * What a client may ask for. Length is constrained to the offered set: an
 * arbitrary duration would fragment every leaderboard and give a cheat a
 * bespoke category to top.
 */
export const issueRequestSchema = z
  .object({
    mode: modeSchema,
    duration: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
    count: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
    punctuation: z.boolean(),
    numbers: z.boolean(),
  })
  .refine((value) => (value.mode === "time" ? value.duration !== undefined : true), {
    message: "duration is required for time mode",
  })
  .refine((value) => (value.mode === "words" ? value.count !== undefined : true), {
    message: "count is required for words mode",
  });

export type IssueRequest = z.infer<typeof issueRequestSchema>;

export interface IssueResponse {
  testId: string;
  seed: string;
  mode: "time" | "words";
  duration?: number;
  count?: number;
  punctuation: boolean;
  numbers: boolean;
  issuedAt: string;
}

/** One recorded keystroke, mirroring the engine's `KeyEvent`. */
export const keyEventSchema = z.object({
  t: z.number().finite().min(0).max(3_600_000),
  key: z.string().min(1).max(16),
  code: z.string().max(32),
  kind: z.enum(["char", "space", "backspace", "word-back"]),
  expected: z.string().max(4).nullable(),
  correct: z.boolean(),
  word: z.number().int().min(0).max(20_000),
  hold: z.number().finite().min(0).max(60_000).optional(),
});

export const submitRequestSchema = z.object({
  // Capped so one request cannot be used to exhaust memory. 20k keystrokes is
  // far beyond any legitimate 60-second run.
  events: z.array(keyEventSchema).min(1).max(20_000),
  /**
   * What the client believes it scored. The server recomputes everything from
   * the events regardless; this exists so a disagreement is detectable rather
   * than silently papered over.
   */
  claimed: z
    .object({
      wpm: z.number().finite(),
      accuracy: z.number().finite(),
    })
    .optional(),
});

export type SubmitRequest = z.infer<typeof submitRequestSchema>;

export type Verification = "verified" | "flagged" | "rejected";

export interface SubmitResponse {
  verification: Verification;
  reasons: string[];
  results: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    consistency: number;
    durationMs: number;
    chars: { correct: number; incorrect: number; extra: number; missed: number };
  };
  /** Present when this run set a personal best. */
  personalBest?: { previous: number | null; wpm: number };
}

export interface MeResponse {
  id: string;
  username: string;
}

/**
 * ─── Boards, history and profiles ───────────────────────────────────────────
 *
 * A board is a **(mode, length)** pair and nothing else. Modifiers are a
 * player's choice of difficulty, not a category: splitting boards by
 * punctuation and numbers would quarter the population on every board and hand
 * anyone willing to pick an empty combination a rank they did not earn. Each
 * row still reports which modifiers were on, so a punctuated run near the top
 * reads as the achievement it is.
 */

export const BOARD_WINDOWS = ["daily", "weekly", "all"] as const;
export type BoardWindow = (typeof BOARD_WINDOWS)[number];

/** How long a window is worth, in milliseconds. `all` has no lower bound. */
export const WINDOW_MS: Record<Exclude<BoardWindow, "all">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const numeric = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]);

export const leaderboardQuerySchema = z
  .object({
    mode: modeSchema,
    length: numeric,
    window: z.enum(BOARD_WINDOWS).default("all"),
    limit: numeric.pipe(z.number().int().min(1).max(100)).default(50),
  })
  .refine(
    (value) =>
      value.mode === "time"
        ? (DURATIONS as readonly number[]).includes(value.length)
        : (WORD_COUNTS as readonly number[]).includes(value.length),
    { message: "length is not an offered board" },
  );

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  testId: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  punctuation: boolean;
  numbers: boolean;
  achievedAt: string;
}

export interface LeaderboardResponse {
  mode: "time" | "words";
  length: number;
  window: BoardWindow;
  entries: LeaderboardEntry[];
  /**
   * The signed-in player's standing on this board, even when it falls outside
   * the returned page. Null when they are signed out or have no ranked run
   * here — "not on this board" is a state worth rendering, not an error.
   */
  you: LeaderboardEntry | null;
}

/** One finished run, as a list reads it. The keystroke log stays on the server. */
export interface HistoryEntry {
  id: string;
  mode: "time" | "words";
  length: number;
  punctuation: boolean;
  numbers: boolean;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  verification: Verification;
  createdAt: string;
}

export const historyQuerySchema = z.object({
  limit: numeric.pipe(z.number().int().min(1).max(100)).default(25),
  /** Keyset pagination: the `createdAt` of the last row you were given. */
  before: z.string().datetime().optional(),
  mode: modeSchema.optional(),
  length: numeric.optional(),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export interface HistoryResponse {
  entries: HistoryEntry[];
  /** Pass back as `before` for the next page. Null at the end of history. */
  nextCursor: string | null;
}

export interface PersonalBestEntry {
  mode: "time" | "words";
  length: number;
  wpm: number;
  testId: string;
  achievedAt: string;
}

export interface ProfileResponse {
  username: string;
  joinedAt: string;
  totals: {
    /** Verified runs only — the same population the averages are taken over. */
    tests: number;
    /** Seconds spent typing, across every verified run. */
    secondsTyped: number;
    averageWpm: number;
    averageAccuracy: number;
    bestWpm: number;
  };
  personalBests: PersonalBestEntry[];
  /**
   * Oldest first, so a chart can plot it without reversing. Verified runs only:
   * a trend line is a claim about a player's speed, and a rejected run is not
   * evidence of anything.
   */
  recent: HistoryEntry[];
}

/**
 * A single run, replayed.
 *
 * `samples` are recomputed on the server from the stored keystrokes rather than
 * read from a column, so a run's chart is drawn from the same evidence the
 * verifier judged — there is no second, divergent copy of the truth.
 */
export interface RunResponse extends HistoryEntry {
  username: string | null;
  reasons: string[];
  chars: { correct: number; incorrect: number; extra: number; missed: number };
  samples: { t: number; wpm: number; rawWpm: number; errors: number }[];
}

/**
 * ─── Analysis ───────────────────────────────────────────────────────────────
 *
 * The wire shapes here are the analytics package's own types, re-exported rather
 * than re-declared. The server computes them and the browser draws them, so a
 * second declaration would be a second definition of what a bigram is — free to
 * drift, and silently wrong when it did.
 */

export type {
  BigramClass,
  BigramStat,
  Finger,
  Hand,
  KeyStat,
  Keystroke,
  RollProfile,
} from "@bettertyping/analytics";

/**
 * Runs before a player's per-key figures are worth reading.
 *
 * Below this the analysis is drawn, labelled, and honest about being early —
 * SPEC §8 asks for a state that counts down to the unlock rather than a blank
 * panel, and a blank panel is what a naive "hide until ready" would give.
 */
export const RUNS_FOR_CONFIDENCE = 10;

export interface AnalysisResponse {
  username: string;
  /** Verified runs this analysis is folded from. */
  runs: number;
  /** Runs still to go before the figures settle. Zero once there are enough. */
  runsUntilConfident: number;
  keys: KeyStat[];
  bigrams: BigramStat[];
  rolls: RollProfile;
  /**
   * Whether the observed board agrees with QWERTY. False means the legends came
   * from the player's own keystrokes and no key was guessed at.
   */
  qwertyLike: boolean;
  /**
   * Runs that contributed a hold. Zero means every run here predates dwell
   * capture, and no dwell figure on any surface has anything behind it.
   */
  dwellRuns: number;
  /** Recent verified runs, newest first, so a Ribbon can be chosen. */
  recent: HistoryEntry[];
}

/**
 * One run, keystroke by keystroke.
 *
 * Re-derived by replaying the stored log through the engine rather than read
 * from a column, for the same reason `/tests/:id` recomputes its chart: the
 * drawing and the verdict have to come from one piece of evidence.
 */
export interface RibbonResponse extends HistoryEntry {
  username: string | null;
  /** False for a run recorded before dwell capture; every dwell reads null. */
  hasDwell: boolean;
  keystrokes: Keystroke[];
}
