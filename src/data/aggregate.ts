// Pure aggregators over already-parsed SLEvent[] / HazardEvent[] rows. No echarts types here —
// chart option builders (src/components/charts/*) consume this plain data. SPEC 4.4-4.6, 6.1-6.2.

import type { CategoryCount, GenderSplit, SLEvent, HazardEvent, Severity } from '@/types'
import {
  ALL_PROVINCES,
  AGE_BANDS,
  CATEGORY_ORDERS,
  PATIENT_GROUP7_ALIASES,
  RISK_DENOMINATOR_STATUSES,
  RISK_KEYWORDS,
  SIGN_KEYWORDS,
  HAZARD_TYPES,
  HAZARD_UNSPECIFIED_LABEL,
  THAI_MONTHS,
} from '@/config'
import { collapseWs, monthLabel } from './normalize'

/** Minimal shape the month-coverage helpers need — satisfied by both SLEvent and HazardEvent. */
type DatedRow = { month: number | null; year: number | null; sortKey: number }

/**
 * Count rows by a category value. Blank and '-' cells are dropped (SPEC 4.5).
 *
 * Without `order`: only categories that actually occur, sorted by count descending.
 * With `order`: every listed category is included (even at count 0, so a fixed-shape chart
 * like the 5-group patient bar or the 6-hazard pie never "loses" a slice), matched against the
 * data whitespace-insensitively (SPEC 3.2's diagnosis column has a double space that a naive
 * literal match can miss depending on how it round-trips — see docs/BUILD_NOTES.md). Category
 * values found in the data but absent from `order` are appended afterwards, sorted by count
 * descending, never dropped (SPEC 4.5).
 */
export function countBy<T>(rows: T[], pick: (row: T) => string, order?: string[]): CategoryCount[] {
  const rawCounts = new Map<string, number>()
  for (const row of rows) {
    const raw = pick(row)
    const v = raw == null ? '' : String(raw).trim()
    if (v === '' || v === '-') continue
    rawCounts.set(v, (rawCounts.get(v) ?? 0) + 1)
  }

  if (!order || order.length === 0) {
    return Array.from(rawCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }

  const consumed = new Set<string>()
  const result: CategoryCount[] = order.map((label) => {
    const target = collapseWs(label)
    let value = 0
    rawCounts.forEach((count, raw) => {
      if (collapseWs(raw) === target) {
        value += count
        consumed.add(raw)
      }
    })
    return { name: label, value }
  })

  const extras: CategoryCount[] = []
  rawCounts.forEach((value, raw) => {
    if (!consumed.has(raw)) extras.push({ name: raw, value })
  })
  extras.sort((a, b) => b.value - a.value)

  return [...result, ...extras]
}

/** Top N categories by count descending. Blank/'-' dropped, no fixed order. */
export function topN<T>(rows: T[], pick: (row: T) => string, n: number): CategoryCount[] {
  return countBy(rows, pick).slice(0, n)
}

/**
 * SPEC 6.1 widget 8 — การวินิจฉัยโรค (ชีต2 col 12) restricted to the 3 psychiatric values
 * (SPEC 3.2). This column is the one place SPEC 3.2 and SPEC 4.5 disagree: 4.5's general
 * countBy() contract appends any value outside the fixed order rather than dropping it (12+
 * other widgets depend on that append-extras behaviour), but 3.2 says the 4 non-psychiatric
 * diagnosis values (ไม่พบประวัติ, มีประวัติใช้สารเสพติด, ผู้ป่วย SMI-V,
 * ข้อมูลไม่เพียงพอต่อการตรวจสอบ — these belong to the SEPARATE ผู้ป่วยจิตเวช/อื่นๆ group column,
 * not this diagnosis pie) are "excluded from the pie". Pre-filtering to the allowed set before
 * calling countBy keeps countBy's general contract intact for every other consumer while giving
 * this one widget the SPEC 3.2 shape: 3 slices. Totals per fixture — 170 (89 + 64 + 17) on the
 * legacy narrow ชีต2 tab that BUILD_NOTES measured, 230 (88 + 26 + 116) on the refreshed
 * 2026-09-12 wide tab the app now fetches; the shape is what is fixed, not the total.
 *
 * The review deck asks for the SEVEN-group view of this same column instead — that is
 * patientGroup7Counts(), which lives beside this function rather than replacing it, because
 * CATEGORY_ORDERS.diagnosis doubles as this function's allow-list: growing that array from 3 to 7
 * would silently turn this 3-slice pie into a 7-slice one.
 */
export function psychiatricDiagnosisCounts(rows: SLEvent[]): CategoryCount[] {
  const allowed = new Set(CATEGORY_ORDERS.diagnosis.map(collapseWs))
  const filtered = rows.filter((r) => allowed.has(collapseWs(r.diagnosis)))
  return countBy(filtered, (r) => r.diagnosis, CATEGORY_ORDERS.diagnosis)
}

/** Longest gap-filled axis monthlyTrend() will build. One mistyped year (BUILD_NOTES documents
 *  such rows) must not be able to expand the trend axis to thousands of empty categories. */
const MAX_TREND_MONTHS = 240

/** month/year back out of a sortKey (= year * 12 + month), as the 'ต.ค. 68' trend label. */
function labelOfSortKey(sortKey: number): string {
  const month = ((sortKey - 1) % 12) + 1
  const year = Math.floor((sortKey - 1) / 12)
  return monthLabel(month, year)
}

/**
 * One month on the trend axis. `value` is null — and `missing` true — when the month was never
 * reported at all, which UX-02 (fix item 4) requires to be visibly different from a confirmed
 * zero: a chart must break there rather than plot a fabricated 0.
 */
export interface TrendPoint {
  label: string // e.g. 'ต.ค. 68'
  value: number | null
  sortKey: number
  missing: boolean
}

export interface MonthlyTrendOptions {
  /** Clip the axis to a validated coverage window (see coverageWindow()), inclusive. */
  fromKey?: number
  toKey?: number
  /**
   * Month keys the WHOLE dataset reported (reportedMonthKeys() over the unfiltered rows). A month
   * inside the window that is absent here has not been reported → null/missing; a month present
   * here with no row in `rows` is a real zero for the current filter scope → 0.
   * Omitted: every gap is treated as a zero, the pre-UX-02 behaviour.
   */
  reportedKeys?: Set<number>
}

/**
 * Monthly trend as a CONTINUOUS month sequence (UX-02: plotted months must be adjacent in
 * calendar time — the old sparse axis put ธ.ค. 69 right next to มิ.ย. 69 and made unrelated
 * months look consecutive). The span is the coverage window when one is given, otherwise the
 * earliest..latest month present in `rows`; rows outside the window are clipped so the chart can
 * never contradict the coverage label printed above it. Months are labelled in the same
 * 'ต.ค. 68' form as the rows' own monthLabel. Rows with an unresolved month/year (sortKey 0) stay
 * excluded — they cannot be placed on the timeline. SPEC 4.1.
 */
export function monthlyTrend(
  rows: { sortKey: number; monthLabel: string }[],
  options: MonthlyTrendOptions = {},
): TrendPoint[] {
  const { fromKey, toKey, reportedKeys } = options
  const byKey = new Map<number, { label: string; value: number }>()
  for (const row of rows) {
    if (row.sortKey <= 0) continue
    if (fromKey !== undefined && row.sortKey < fromKey) continue
    if (toKey !== undefined && row.sortKey > toKey) continue
    const existing = byKey.get(row.sortKey)
    if (existing) existing.value++
    else byKey.set(row.sortKey, { label: row.monthLabel, value: 1 })
  }

  const keys = Array.from(byKey.keys()).sort((a, b) => a - b)
  const first = fromKey ?? keys[0]
  const last = toKey ?? keys[keys.length - 1]
  if (first === undefined || last === undefined || last < first) return []

  if (last - first + 1 > MAX_TREND_MONTHS) {
    // Implausible span (a bad year cell): fall back to plotting only the months that have rows.
    return keys.map((sortKey) => {
      const hit = byKey.get(sortKey)!
      return { label: hit.label || labelOfSortKey(sortKey), value: hit.value, sortKey, missing: false }
    })
  }

  const points: TrendPoint[] = []
  for (let sortKey = first; sortKey <= last; sortKey++) {
    const hit = byKey.get(sortKey)
    if (hit) {
      points.push({ label: hit.label || labelOfSortKey(sortKey), value: hit.value, sortKey, missing: false })
      continue
    }
    const reported = reportedKeys ? reportedKeys.has(sortKey) : true
    points.push({
      label: labelOfSortKey(sortKey),
      value: reported ? 0 : null,
      sortKey,
      missing: !reported,
    })
  }
  return points
}

/** Counts by province, all 77 provinces in zone order (0-filled) so a density map always has
 *  every feature; any value that didn't normalise to a known province is appended as an extra. */
export function provinceCounts(rows: { province: string }[]): CategoryCount[] {
  return countBy(rows, (r) => r.province, ALL_PROVINCES)
}

/**
 * Counts by zone, all 13 zones in order (0-filled), labelled 'เขตสุขภาพที่ N' (review deck: the
 * axis must spell the unit out, matching the section titles and the zone-tab copy).
 *
 * The label is built TWICE here — once for the fixed order, once as the pick key — and the two
 * MUST stay identical: change only one and countBy() emits 13 empty buckets under the old label
 * plus 13 appended ones under the new, a chart that renders perfectly and is entirely wrong.
 */
export function zoneCounts(rows: { zone: number | null }[]): CategoryCount[] {
  const zoneLabel = (z: number) => `เขตสุขภาพที่ ${z}`
  const order = Array.from({ length: 13 }, (_, i) => zoneLabel(i + 1))
  return countBy(rows, (r) => (r.zone === null ? '' : zoneLabel(r.zone)), order)
}

/** KPI severity counts. `total` is every row regardless of severity (an 'unknown' row still
 *  counts toward ทั้งหมด, it just has no badge colour of its own). */
export function severityCounts(rows: { severity: Severity }[]): {
  black: number
  red: number
  yellow: number
  total: number
} {
  let black = 0
  let red = 0
  let yellow = 0
  for (const row of rows) {
    if (row.severity === 'black') black++
    else if (row.severity === 'red') red++
    else if (row.severity === 'yellow') yellow++
  }
  return { black, red, yellow, total: rows.length }
}

/** Six age bands (SPEC 4.3), each split by gender. `total` is every row in the band regardless
 *  of gender, so the six bands still sum to the full row count even if a future gender value
 *  other than ชาย/หญิง appears. */
export function ageBandByGender(rows: { ageBand: string; gender: string }[]): {
  band: string
  male: number
  female: number
  total: number
}[] {
  return AGE_BANDS.map((band) => {
    let male = 0
    let female = 0
    let total = 0
    for (const row of rows) {
      if (row.ageBand !== band.label) continue
      total++
      const g = collapseWs(row.gender)
      if (g === 'ชาย') male++
      else if (g === 'หญิง') female++
    }
    return { band: band.label, male, female, total }
  })
}

/** Overall gender split. `other` = rows whose gender is neither ชาย nor หญิง (blank included). */
export function genderSplit(rows: { gender: string }[]): GenderSplit {
  let male = 0
  let female = 0
  for (const row of rows) {
    const g = collapseWs(row.gender)
    if (g === 'ชาย') male++
    else if (g === 'หญิง') female++
  }
  const total = rows.length
  return { male, female, other: total - male - female, total }
}

/** Deaths / injuries summed per patient group (SPEC 6.1 widget 9), fixed 5-group order with any
 *  unlisted value appended. */
export function impactByPatientGroup(rows: { patientGroup: string; deaths: number; injured: number }[]): {
  group: string
  deaths: number
  injured: number
}[] {
  const sums = new Map<string, { deaths: number; injured: number }>()
  for (const row of rows) {
    const v = row.patientGroup.trim()
    if (v === '' || v === '-') continue
    const cur = sums.get(v) ?? { deaths: 0, injured: 0 }
    cur.deaths += row.deaths
    cur.injured += row.injured
    sums.set(v, cur)
  }

  const consumed = new Set<string>()
  const result = CATEGORY_ORDERS.patientGroup.map((label) => {
    const target = collapseWs(label)
    let deaths = 0
    let injured = 0
    sums.forEach((val, raw) => {
      if (collapseWs(raw) === target) {
        deaths += val.deaths
        injured += val.injured
        consumed.add(raw)
      }
    })
    return { group: label, deaths, injured }
  })

  const extras: { group: string; deaths: number; injured: number }[] = []
  sums.forEach((val, raw) => {
    if (!consumed.has(raw)) extras.push({ group: raw, deaths: val.deaths, injured: val.injured })
  })

  return [...result, ...extras]
}

/** What riskFactors()/warningSigns() return. `denominator` — NOT `affected` — is the base every
 *  per-factor percentage must be divided by (see riskFactors' worked example). */
export interface FactorBreakdown {
  items: CategoryCount[]
  denominator: number
  affected: number
}

/** The patient statuses that can carry a risk factor, whitespace-normalised for comparison. */
const RISK_DENOMINATOR_SET = new Set(RISK_DENOMINATOR_STATUSES.map(collapseWs))

/** True when a row's ประเภทผู้ป่วย is one of the four psychiatric/substance statuses. */
export function isRiskDenominatorRow(row: { patientStatus: string }): boolean {
  return RISK_DENOMINATOR_SET.has(collapseWs(row.patientStatus))
}

/**
 * ปัจจัยเสี่ยง — review deck slide 13. Read from SLEvent.riskFlags (cols 74-77 are single-value
 * FLAG columns since the 2026-09-12 restructure), no longer from a keyword scan of free text.
 *
 * DENOMINATOR (the deck states this explicitly): only rows whose ประเภทผู้ป่วย is one of the four
 * psychiatric/substance statuses — "จะหารแค่ ผู้ป่วยจิตเวชรายเก่า จิตเวชรายใหม่
 * ผู้ใช้สารเสพติดรายเก่า ผู้ใช้สารเสพติดรายใหม่ จะไม่เอา คำว่า
 * ไม่ใช่ผู้ป่วยจิตเวช/ไม่ใช่ผู้ใช้สารเสพติด มาคิด" — and the deck's worked example fixes the
 * percentage base too: of 100 people in 5 equal groups only 80 can have a factor, so ขาดยา 20
 * reads 20*100/80 = 25%. Every per-factor percentage is therefore value/denominator, NEVER
 * value/affected. 417 / 413 on the 2026-09-12 fixture.
 *
 * This replaces the previous scoping to CATEGORY_ORDERS.patientClass[0] ('ผู้ป่วยรายเก่า'), a
 * positional lookup into a column whose vocabulary the sheet owner has since replaced — after the
 * restructure it matched nothing at all.
 */
export function riskFactors(rows: SLEvent[]): FactorBreakdown {
  const scoped = rows.filter(isRiskDenominatorRow)
  const items: CategoryCount[] = RISK_KEYWORDS.map((k) => ({ name: k.label, value: 0 }))
  let affected = 0

  for (const row of scoped) {
    let hasAny = false
    for (let i = 0; i < items.length; i++) {
      if (row.riskFlags[i]) {
        items[i].value++
        hasAny = true
      }
    }
    if (hasAny) affected++
  }

  return { items, denominator: scoped.length, affected }
}

function joinRiskSignCells(riskCells?: string[], signCells?: string[]): string {
  return [...(riskCells ?? []), ...(signCells ?? [])]
    .map((c) => c.trim())
    .filter((c) => c !== '' && c !== '-')
    .join(' ')
}

function compileKeywordsRegex(keywords: string[]): RegExp | null {
  if (!keywords || keywords.length === 0) return null
  const pattern = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(pattern)
}

const SIGN_REGEXES = SIGN_KEYWORDS.map((k) => compileKeywordsRegex(k.keywords))

/**
 * 5 สัญญาณเตือน — review deck slide 14. Read from SLEvent.signFlags (cols 78-82 as FLAG columns);
 * signFlags[i] belongs to SIGN_KEYWORDS[i] by construction (the parser resolves each sign to its
 * own column by header name, because the display order is not the column order).
 *
 * DENOMINATOR = ALL filtered events — "จะหารจำนวนข่าวทั้งหมดนะ เพราะทุกคนสามารถเป็น 5 สัญญาณได้".
 * Per-sign percentages divide by `denominator`, same rule as riskFactors. 350 of 580 rows carry at
 * least one sign on the 2026-09-12 fixture (60.3%).
 */
export function warningSigns(rows: SLEvent[]): FactorBreakdown {
  const items: CategoryCount[] = SIGN_KEYWORDS.map((k) => ({ name: k.label, value: 0 }))
  let affected = 0

  for (const row of rows) {
    let hasAny = false
    let textMemo: string | null = null
    const getText = () => {
      if (textMemo === null) {
        textMemo = joinRiskSignCells(row.riskCells, row.signCells)
      }
      return textMemo
    }

    for (let i = 0; i < items.length; i++) {
      let match = false
      if (row.signFlags && row.signFlags.length > i) {
        match = row.signFlags[i]
      } else {
        const regex = SIGN_REGEXES[i]
        match = regex ? regex.test(getText()) : false
      }

      if (match) {
        items[i].value++
        hasAny = true
      }
    }
    if (hasAny) affected++
  }

  return { items, denominator: rows.length, affected }
}

/**
 * ประเภทผู้ป่วย (col 14) — the 5-way status donut, fixed order, 0-filled. Counts the NORMALIZED
 * `patientStatus`, so the quote-wrapped ไม่ใช่ผู้ป่วยจิตเวช value lands in its own slice instead
 * of a sixth look-alike one. 269 / 7 / 67 / 73 / 163 on the 2026-09-12 fixture.
 */
export function patientStatusCounts(rows: SLEvent[]): CategoryCount[] {
  return countBy(rows, (r) => r.patientStatus, CATEGORY_ORDERS.patientStatus5)
}

/**
 * Raw col-12 value → the deck's SHORT group label. The three long '(Dx. …)' spellings are listed
 * in PATIENT_GROUP7_ALIASES; anything else falls back to the text before the first ' (', which
 * keeps a re-worded parenthetical from silently creating a new category.
 */
function group7Label(raw: string): string {
  const t = collapseWs(raw)
  if (t === '' || t === '-') return ''
  const alias = PATIENT_GROUP7_ALIASES[t]
  if (alias !== undefined) return alias
  const paren = t.indexOf(' (')
  return paren > 0 ? t.slice(0, paren).trim() : t
}

/**
 * การประเมินกลุ่มผู้ป่วย (col 12) as the deck's SEVEN groups (slide 15), short labels, fixed
 * order, 0-filled. Distinct from psychiatricDiagnosisCounts(), which keeps SPEC 3.2's 3-slice
 * psychiatric-only pie over the same column.
 */
export function patientGroup7Counts(rows: SLEvent[]): CategoryCount[] {
  return countBy(rows, (r) => group7Label(r.diagnosis), CATEGORY_ORDERS.patientGroup7)
}

/** Deaths / injuries summed per deck group, fixed 7-group order with any unlisted value appended
 *  (SPEC 4.5). Same shape as impactByPatientGroup(), which stays on the col-13 5-group column. */
export function impactByGroup7(rows: SLEvent[]): { group: string; deaths: number; injured: number }[] {
  const sums = new Map<string, { deaths: number; injured: number }>()
  for (const row of rows) {
    const label = group7Label(row.diagnosis)
    if (label === '') continue
    const cur = sums.get(label) ?? { deaths: 0, injured: 0 }
    cur.deaths += row.deaths
    cur.injured += row.injured
    sums.set(label, cur)
  }

  const result = CATEGORY_ORDERS.patientGroup7.map((group) => {
    const hit = sums.get(group)
    sums.delete(group)
    return { group, deaths: hit?.deaths ?? 0, injured: hit?.injured ?? 0 }
  })

  const extras: { group: string; deaths: number; injured: number }[] = []
  sums.forEach((val, group) => extras.push({ group, deaths: val.deaths, injured: val.injured }))
  extras.sort((a, b) => b.deaths + b.injured - (a.deaths + a.injured))

  return [...result, ...extras]
}

/** Six age bands (SPEC 4.3) counted over ALL rows, NOT split by gender — the deck's single-series
 *  ช่วงวัย chart. ageBandByGender() keeps the gender split for the stacked variant. */
export function ageBandCounts(rows: { ageBand: string }[]): CategoryCount[] {
  return AGE_BANDS.map((band) => ({
    name: band.label,
    value: rows.reduce((acc, row) => (row.ageBand === band.label ? acc + 1 : acc), 0),
  }))
}

/**
 * Section 2 casualty totals (cols 47/48/50/51). `total` is all four summed — the headline figure
 * the deck asks for. 16 / 13 / 672 / 151 (total 852) on the 2026-09-12 fixture.
 */
export function hazardCasualties(rows: HazardEvent[]): {
  officerInjured: number
  officerDead: number
  publicInjured: number
  publicDead: number
  total: number
} {
  let officerInjured = 0
  let officerDead = 0
  let publicInjured = 0
  let publicDead = 0
  for (const row of rows) {
    officerInjured += row.officerInjured
    officerDead += row.officerDead
    publicInjured += row.publicInjured
    publicDead += row.publicDead
  }
  return {
    officerInjured,
    officerDead,
    publicInjured,
    publicDead,
    total: officerInjured + officerDead + publicInjured + publicDead,
  }
}

/** Suicide subset (SPEC 4.6): การฆ่าตัวตาย not blank and not '-'. */
export function suicideSubset(rows: SLEvent[]): SLEvent[] {
  return rows.filter((r) => {
    const t = r.suicide.trim()
    return t !== '' && t !== '-'
  })
}

/** Hazard-type pie (SPEC 3.3): counted once per flag a row carries; the 6 flag categories plus
 *  the ภัยอื่นๆ (ไม่ระบุ) fallback are always present (0-filled) so the legend never drops a slice. */
export function hazardTypeCounts(rows: HazardEvent[]): CategoryCount[] {
  const order = [...HAZARD_TYPES.map((h) => h.label), HAZARD_UNSPECIFIED_LABEL]
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const label of row.hazards) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return order.map((name) => ({ name, value: counts.get(name) ?? 0 }))
}

/**
 * 'ข้อมูลล่าสุดถึง <เดือน ปี>' body text (SPEC 3.5), e.g. 'มิถุนายน 2569'. The newest month in
 * the data that is NOT in the future relative to `now` (BUILD_NOTES: the sheet has data-entry
 * errors that date rows into the future; those must not be reported as "latest"). Self-updating
 * as the sheet grows — never hardcode the resulting string. Returns '' when nothing qualifies.
 */
export function latestDataMonth(rows: DatedRow[], now: Date = new Date()): string {
  return boundaryDataMonth(rows, 'latest', now)
}

/**
 * Mirror of latestDataMonth() for the OTHER end of the coverage window, e.g. 'ตุลาคม 2568'.
 * UX-02 asks the section to state what the data actually covers ('ครอบคลุม <first> – <latest>'),
 * which needs both boundaries. Same exclusions: unresolved and future-dated rows don't count.
 */
export function earliestDataMonth(rows: DatedRow[], now: Date = new Date()): string {
  return boundaryDataMonth(rows, 'earliest', now)
}

/** The current month as a sortKey (BE year * 12 + month) — the cut-off for "in the future". */
function currentMonthKey(now: Date): number {
  return (now.getFullYear() + 543) * 12 + (now.getMonth() + 1)
}

function boundaryDataMonth(rows: DatedRow[], which: 'earliest' | 'latest', now: Date): string {
  const nowKey = currentMonthKey(now)
  let best: { sortKey: number; month: number; year: number } | null = null
  for (const row of rows) {
    if (row.month === null || row.year === null) continue
    if (row.sortKey <= 0 || row.sortKey > nowKey) continue
    const better = !best || (which === 'latest' ? row.sortKey > best.sortKey : row.sortKey < best.sortKey)
    if (better) best = { sortKey: row.sortKey, month: row.month, year: row.year }
  }
  if (!best) return ''
  return `${THAI_MONTHS[best.month - 1]} ${best.year}`
}

/**
 * Rows dated AFTER the current calendar month — data-entry errors (BUILD_NOTES: the sheet has
 * rows typed into the future). They are never reported as the latest data month, but they do
 * still reach the event table, so the UI can surface how many there are for review (UX-02).
 */
export function futureDatedRows<T extends { sortKey: number }>(rows: T[], now: Date = new Date()): T[] {
  const nowKey = currentMonthKey(now)
  return rows.filter((row) => row.sortKey > nowKey)
}

/** Every month (as a sortKey) the dataset actually reported, future-dated rows excluded. */
export function reportedMonthKeys(rows: DatedRow[], now: Date = new Date()): Set<number> {
  const nowKey = currentMonthKey(now)
  const keys = new Set<number>()
  for (const row of rows) {
    if (row.sortKey <= 0 || row.sortKey > nowKey) continue
    keys.add(row.sortKey)
  }
  return keys
}

/** First/last month of the validated reporting period, both as sortKeys and as 'ตุลาคม 2568'. */
export interface CoverageWindow {
  firstKey: number
  lastKey: number
  firstLabel: string
  lastLabel: string
}

/** The `firstKey`/`lastKey` pair the out-of-period helpers need. */
export type PeriodBounds = Pick<CoverageWindow, 'firstKey' | 'lastKey'>

/**
 * How many CONSECUTIVE empty months end the reporting period when walking backwards from the
 * newest reported month. One empty month inside an otherwise continuous run is a genuine zero;
 * a longer hole means reporting had not started yet (BUILD_NOTES: ชีต2's ม.ค. 2568 rows are a
 * data-entry error separated from the real run ต.ค. 2568 – มิ.ย. 2569 by 8 empty months).
 */
const REPORTING_GAP_TOLERANCE = 2

/** Full-month label ('ตุลาคม 2568') for a sortKey, matching latestDataMonth()'s wording. */
function fullLabelOfSortKey(sortKey: number): string {
  const month = ((sortKey - 1) % 12) + 1
  const year = Math.floor((sortKey - 1) / 12)
  return `${THAI_MONTHS[month - 1]} ${year}`
}

/**
 * The period the data really covers (UX-02): it ends at latestDataMonth() and starts at the
 * beginning of the contiguous reported run leading up to it, so a stray out-of-period row cannot
 * stretch the advertised coverage over months that contain nothing. Rows outside the window are
 * what outOfPeriodRows() flags for review. Returns null when nothing qualifies.
 */
export function coverageWindow(rows: DatedRow[], now: Date = new Date()): CoverageWindow | null {
  const keys = reportedMonthKeys(rows, now)
  if (keys.size === 0) return null

  const sorted = Array.from(keys).sort((a, b) => a - b)
  const lastKey = sorted[sorted.length - 1]
  const earliestKey = sorted[0]

  let firstKey = lastKey
  let gap = 0
  for (let key = lastKey - 1; key >= earliestKey; key--) {
    if (keys.has(key)) {
      firstKey = key
      gap = 0
      continue
    }
    gap++
    if (gap >= REPORTING_GAP_TOLERANCE) break
  }

  return {
    firstKey,
    lastKey,
    firstLabel: fullLabelOfSortKey(firstKey),
    lastLabel: fullLabelOfSortKey(lastKey),
  }
}

/** True when a row's month falls outside the validated coverage window (either end). */
export function isOutOfPeriod(sortKey: number, bounds: PeriodBounds | null | undefined): boolean {
  if (!bounds || sortKey <= 0) return false
  return sortKey < bounds.firstKey || sortKey > bounds.lastKey
}

/**
 * Rows dated outside the validated reporting period, split by which end they fall off (UX-02
 * fix item 5). `after` is the future-dated data-entry errors futureDatedRows() also finds;
 * `before` is the equally suspect too-early ones, which nothing flagged until now.
 */
export function outOfPeriodRows<T extends { sortKey: number }>(
  rows: T[],
  bounds: PeriodBounds | null | undefined,
): { before: T[]; after: T[] } {
  const before: T[] = []
  const after: T[] = []
  if (!bounds) return { before, after }
  for (const row of rows) {
    if (row.sortKey <= 0) continue
    if (row.sortKey < bounds.firstKey) before.push(row)
    else if (row.sortKey > bounds.lastKey) after.push(row)
  }
  return { before, after }
}
