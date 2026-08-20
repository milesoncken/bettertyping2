/** Samples either side of a point when computing its confidence band. */
export const BAND_WINDOW = 4;

export interface Band {
  hi: number;
  lo: number;
}

/**
 * The ±1σ confidence band, from a series' own rhythm.
 *
 * A centred rolling mean and standard deviation. Where the series leaves the
 * band, it broke its own pattern — within a run that is the moment worth
 * celebrating, and across a history it is the run that stands out from the
 * player's form.
 *
 * It needs no history to work, so it is never empty on a first visit. Stage 6
 * swaps the source for a model fitted across a player's history; nothing that
 * draws it has to change.
 */
export function bandOf(values: readonly number[], window = BAND_WINDOW): Band[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - window);
    const to = Math.min(values.length - 1, i + window);
    let sum = 0;
    let count = 0;
    for (let j = from; j <= to; j++) {
      sum += values[j]!;
      count += 1;
    }
    const mean = sum / count;
    let variance = 0;
    for (let j = from; j <= to; j++) variance += (values[j]! - mean) ** 2;
    const sd = Math.sqrt(variance / count);
    return { hi: mean + sd, lo: Math.max(0, mean - sd) };
  });
}
