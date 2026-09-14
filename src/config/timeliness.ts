// Timeliness score levels. SPEC 6.4, restated by review deck slide 23 ("เกณฑ์การให้คะแนน").
// Colours resolved to hex (rather than Tailwind family names) since tailwind.config.js cannot be
// edited here and dynamic `text-${color}-600` class names would not survive Tailwind's
// class-detection/purge.

export type TimelinessTone = 'good' | 'fair' | 'poor'

export interface TimelinessLevelDef {
  /** Row applies when percent >= min (rows are checked highest-min-first; the last row, with
   *  min = -Infinity, is the "< 70.00" catch-all). */
  min: number
  /** The SCORE on the SPEC 6.4 scale, as a string ('0.5' … '0.0'). Deck slide 23 is explicit that
   *  no qualitative word ("ปรับปรุง", "พอใช้", …) may accompany it — the range and the score are
   *  the whole vocabulary. Keep this field numeric-looking: TimelinessCard derives the scale bounds
   *  (SCALE_MIN/SCALE_MAX) from the first and last row's `level` and prints them into two Thai
   *  sentences that become nonsense if `level` stops being the numeric score. */
  level: string
  color: string
  icon: string
  /**
   * ADDITIVE (wave 2). Which `score-*` token pair a UI should tint this row with — the scorecard
   * uses ONE static map for both its legend swatch and its per-zone badge, so a zone badged 0.4
   * is guaranteed to look like the legend's 0.4 row. Three tones over six rows, paired to follow
   * the existing `color` hues: emerald+blue = good, amber+orange = fair, rose+red = poor. The tint
   * never has to carry the meaning on its own — every place that uses it also prints the score.
   * (`score-na` is NOT a tone here: it belongs to a zone with no reporting rows at all, which has
   *  no level and therefore no row in this table.)
   */
  tone: TimelinessTone
}

/** SPEC 6.4 table, ordered highest threshold first. */
export const TIMELINESS_LEVELS: TimelinessLevelDef[] = [
  { min: 90, level: '0.5', color: '#059669', icon: 'Laugh', tone: 'good' }, // emerald
  { min: 85, level: '0.4', color: '#2563EB', icon: 'Smile', tone: 'good' }, // blue
  { min: 80, level: '0.3', color: '#D97706', icon: 'Meh', tone: 'fair' }, // amber
  { min: 75, level: '0.2', color: '#EA580C', icon: 'Frown', tone: 'fair' }, // orange
  { min: 70, level: '0.1', color: '#E11D48', icon: 'Annoyed', tone: 'poor' }, // rose
  { min: -Infinity, level: '0.0', color: '#DC2626', icon: 'Skull', tone: 'poor' }, // red, < 70.00
]

/**
 * The percent-range text for row `i`, derived from the thresholds themselves rather than
 * hardcoded, so a legend can never drift from the config the score is computed against.
 * Lifted out of TimelinessCard in wave 2 so the 13-zone scorecard legend and the card share it.
 *
 * Reads `levels[i - 1].min`, so it — like `computeTimeliness`'s `.find` — depends on the array
 * being sorted DESCENDING by `min`. See the guard below.
 */
export function rangeLabel(levels: TimelinessLevelDef[], i: number): string {
  const cur = levels[i]
  if (i === 0) return `≥ ${cur.min.toFixed(2)}`
  if (cur.min === -Infinity) return `< ${levels[i - 1].min.toFixed(2)}`
  return `${cur.min.toFixed(2)} – ${(levels[i - 1].min - 0.01).toFixed(2)}`
}

// The descending order above is load-bearing in two places that cannot detect a violation
// themselves: computeTimeliness() takes the FIRST row whose `min` the percent clears, and
// rangeLabel() builds each row's upper bound from the PREVIOUS row's `min`. Reordering the array
// would silently mis-score every zone. Cheap check, so it always runs (same pattern as the
// 77-province guard in config/zones.ts).
{
  const descending = TIMELINESS_LEVELS.every((l, i) => i === 0 || TIMELINESS_LEVELS[i - 1].min > l.min)
  if (!descending) {
    throw new Error(
      'TIMELINESS_LEVELS must stay sorted by `min` DESCENDING — computeTimeliness() and rangeLabel() both assume it.',
    )
  }
}
