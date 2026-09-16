// Parses Section 1 (Social Listening) into SLEvent[]. SPEC 3.2.
// Pure: takes already-downloaded CSV rows (string[][]), no network I/O.
//
// COLUMN RESOLUTION (rewritten 2026-09-12). This module has to read THREE layouts:
//   1. the live wide tab, GID_WIDE 842224166 — 85 columns, restructured for the แก้งับ.pdf deck;
//   2. GID_WIDE_FALLBACK 1523955266 — the OLD 84-column schema, which is what a fallback fetch
//      still returns (docs/BUILD_NOTES.md "The fallback gid is NO LONGER a duplicate");
//   3. the legacy narrow ชีต2 tab (37 columns) that scripts/verify-data.ts still parses.
// Every field therefore lists its CURRENT header name first and the older names as ALIASES, and
// only falls back to a column index when no name matches. The old resolver fell back SILENTLY,
// which is exactly how the restructured sheet produced wrong-but-plausible numbers: the risk and
// warning-sign fields kept reading cols 27-36, which now hold Section-2 data. Two safeguards now:
//   * the index fallback is REFUSED when the header sitting at that index is a name some OTHER
//     field claims (that is the old-schema col 76 'ไม่มาตามนัด' vs new 'มีการใช้สารเสพติดร่วมด้วย'
//     collision) — the field resolves to "absent" instead of to the wrong column;
//   * every fallback and every unresolved field is console.warn-ed, once per parse.

import type { SLEvent } from '@/types'
import { RISK_KEYWORDS, SIGN_KEYWORDS } from '@/config'
import {
  cell,
  collapseWs,
  parseMonth,
  parseYear,
  monthLabel,
  sortKeyOf,
  severityOf,
  parseAge,
  ageBandOf,
  zoneOf,
  normProvince,
  normGender,
  normSuicideAgeGroup,
  normPatientStatus,
  collapseDoubledMarks,
  isBlankCell,
} from './normalize'

/** Current-schema column index per field, 0-based (the 85-column wide tab). */
const IDX = {
  zone: 0,
  month: 1,
  year: 2,
  province: 3,
  headline: 4,
  link: 5,
  channel: 6,
  severity: 7,
  reporting: 8,
  gender: 9,
  age: 10,
  suicideAgeGroup: 11,
  diagnosis: 12,
  patientGroup: 13,
  patientClass: 14,
  treatmentHistory: 15,
  suicide: 16,
  suicideMethod: 17,
  suicideCause: 18,
  suicideLocation: 19,
  affected: 20,
  affectedType: 21,
  injured: 22,
  deaths: 23,
  factReport: 24,
  operator: 25,
  assistance: 26,
  /** col 83 — the sheet's own "no psychiatric symptom" flag; its header carries the sheet's
   *  typo 'ไม่มีอการทางจิตเวช' (missing สระอา), transcribed verbatim below. */
  noSymptoms: 83,
  /** col 84 `5สัญญาณเตือน`. */
  fiveSignsAnswer: 84,
} as const

type CoreField = keyof typeof IDX

interface ColumnSpec {
  /** Candidate header names, most-current first, then legacy aliases. */
  names: string[]
  /** Whether an index fallback is expected and therefore not worth warning about. */
  silentFallback?: boolean
}

/**
 * Candidate header names per field. First entry = the live 85-column tab (its Section-1 headers
 * all carry a ' ภัยน้ำมือมนุษย์' suffix), later entries = the old wide tab / narrow ชีต2 tab.
 * Matched whitespace-insensitively (collapseWs) because several real headers carry internal
 * double spaces and trailing newlines.
 */
const COLUMNS: Record<CoreField, ColumnSpec> = {
  zone: { names: ['เขตสุขภาพที่ ภัยน้ำมือมนุษย์', 'เขตสุขภาพ'] },
  // The narrow ชีต2 tab leaves the เดือน header BLANK, so an index fallback is normal there.
  month: { names: ['เดือนภัยน้ำมือมนุษย์'], silentFallback: true },
  year: { names: ['ปีภัยน้ำมือมนุษย์', 'ปี'] },
  province: { names: ['จังหวัดภัยน้ำมือมนุษย์', 'จังหวัด'] },
  headline: { names: ['หัวข้อข่าวภัยน้ำมือมนุษย์', 'เนื้อหา'] },
  link: { names: ['linkภัยน้ำมือมนุษย์', 'link'] },
  channel: { names: ['ช่องทางAlertข่าวภัยน้ำมือมนุษย์', 'ช่องทาง Alert'] },
  severity: { names: ['ระดับความรุนแรง ภัยน้ำมือมนุษย์', 'ระดับความรุนแรง'] },
  reporting: { names: ['รายงานการส่งข่าว ภัยน้ำมือมนุษย์', 'การส่งรายงาน'] },
  gender: { names: ['เพศ ภัยน้ำมือมนุษย์', 'เพศ'] },
  age: { names: ['อายุ ภัยน้ำมือมนุษย์', 'อายุ'] },
  suicideAgeGroup: { names: ['ช่วงอายุวัย ภัยน้ำมือมนุษย์', 'ช่วงอายุ'] },
  diagnosis: { names: ['การประเมินกลุ่มผู้ป่วย ภัยน้ำมือมนุษย์', 'การวินิจฉัยโรค'] },
  patientGroup: { names: ['ผู้ป่วยจิตเวช/อื่นๆ ภัยน้ำมือมนุษย์', 'ผู้ป่วยจิตเวช/อื่นๆ'] },
  patientClass: { names: ['ประเภทผู้ป่วย ภัยน้ำมือมนุษย์', 'การจำแนกผู้ป่วย'] },
  treatmentHistory: { names: ['ประวัติการรักษาจิตเวช ภัยน้ำมือมนุษย์', 'ประวัติการรักษา'] },
  suicide: { names: ['พยายามฆ่าตัวตาย ภัยน้ำมือมนุษย์', 'การฆ่าตัวตาย'] },
  suicideMethod: { names: ['วิธีฆ่าตัวตาย ภัยน้ำมือมนุษย์', 'วิธีการฆ่าคัวตาย'] },
  suicideCause: { names: ['สาเหตุการฆ่าตัวตาย ภัยน้ำมือมนุษย์', 'สาเหตุการฆ่าตัวตาย'] },
  // The live header spells it 'สถานที่ี่การฆ่าตัวตาย' (doubled สระอี) — verbatim, it is the key.
  suicideLocation: { names: ['สถานที่ี่การฆ่าตัวตาย ภัยน้ำมือมนุษย์', 'สถานที่ก่อเหตุ'] },
  affected: { names: ['มีผู้ได้รับผลกระทบ ภัยน้ำมือมนุษย์', 'มีผู้ได้รับผลกระทบ'] },
  affectedType: { names: ['ประเภทผู้ได้รับผลกระทบ ภัยน้ำมือมนุษย์', 'ประเภทผู้ได้รับผลกระทบ'] },
  injured: { names: ['ประชาชนที่ได้รับผลกระทบบาดเจ็บ ภัยน้ำมือมนุษย์', 'จำนวนผู้ได้บาดเจ็บ'] },
  deaths: { names: ['ประชาชนที่ได้รับผลกระทบเสียชีวิต ภัยน้ำมือมนุษย์', 'จำนวนผู้เสียชีวิต'] },
  factReport: { names: ['ข้อเท็จจริงจากสื่อออนไลน์ ภัยน้ำมือมนุษย์', 'รายงานข้อเท็จจริงด้านจิตเวช'] },
  operator: { names: ['ผู้ปฏิบัติงานภัยน้ำมือมนุษย์', 'ผู้ปฏิบัติงาน'] },
  assistance: { names: ['การช่วยเหลือส่งต่อผู้ป่วย ภัยน้ำมือมนุษย์', 'การช่วยเหลือผู้ก่อเหตุ'] },
  noSymptoms: { names: ['ไม่มีอการทางจิตเวช', 'ไม่มีอาการ'] },
  // '5สัญญาณเตือน' appears TWICE in the live tab, at col 29 and col 84, and the two disagree on
  // 77 rows (col 29: 332 มี / 244 ไม่มี + 2 typo'd + 2 blank; col 84: 355 / 225). Col 84 is the
  // authoritative one and is what BUILD_NOTES measured, so resolveOne() prefers the DECLARED index
  // whenever several columns share a candidate name. The old 84-column schema has only col 29,
  // which is then the single match and resolves correctly by name.
  fiveSignsAnswer: { names: ['5สัญญาณเตือน'] },
}

/** Column indexes resolved for one header row. -1 = the field is absent from this layout. */
export interface Resolution {
  core: Record<CoreField, number>
  /** One entry per RISK_KEYWORDS factor: the column(s) that carry it (possibly several, possibly none). */
  risk: number[][]
  /** One entry per SIGN_KEYWORDS factor, same shape. */
  signs: number[][]
}

/** Build the column resolution for a header row, warning (once per parse) about anything that did
 *  not resolve by name. Exported for scripts/diagnostics; parseSheet2() calls it itself. */
export function buildResolver(headerRow: string[]): Resolution {
  const headers = (headerRow ?? []).map((h) => collapseWs(h ?? ''))

  // header name -> every index carrying it (a name can legitimately repeat, see fiveSignsAnswer).
  const byName = new Map<string, number[]>()
  headers.forEach((h, i) => {
    if (h === '') return
    const hit = byName.get(h)
    if (hit) hit.push(i)
    else byName.set(h, [i])
  })

  // Every candidate name -> the field that claims it. Used to REFUSE an index fallback that would
  // land on a column another field owns (old-schema 'ไม่มาตามนัด' at index 76, etc.).
  const claimedBy = new Map<string, string>()
  const claim = (field: string, names: string[]) => {
    for (const n of names) {
      const key = collapseWs(n)
      if (!claimedBy.has(key)) claimedBy.set(key, field)
    }
  }
  ;(Object.keys(COLUMNS) as CoreField[]).forEach((k) => claim(k, COLUMNS[k].names))
  RISK_KEYWORDS.forEach((f) => claim(`risk:${f.key}`, f.headers))
  SIGN_KEYWORDS.forEach((f) => claim(`sign:${f.key}`, f.headers))

  const warned = new Set<string>()
  const warn = (field: string, message: string) => {
    if (warned.has(field)) return
    warned.add(field)
    console.warn(`[parseSheet2] คอลัมน์ "${field}": ${message}`)
  }

  /** Indexes matching the FIRST candidate name that matches anything at all. */
  const firstNameMatch = (names: string[]): number[] => {
    for (const n of names) {
      const hit = byName.get(collapseWs(n))
      if (hit && hit.length > 0) return hit
    }
    return []
  }

  /**
   * Why `index` may NOT be used as a fallback, or null when it may. Two distinct failures, kept
   * apart so a log reader can tell "this layout has no such column" from "this index holds
   * somebody else's data" — the second is the dangerous one.
   */
  const indexRefusal = (field: string, index: number): string | null => {
    if (index < 0 || index >= headers.length) return `ชีตนี้ไม่มีคอลัมน์ที่ ${index}`
    const headerAt = headers[index]
    if (headerAt === '') return null
    const owner = claimedBy.get(headerAt)
    if (owner === undefined || owner === field) return null
    return `คอลัมน์ที่ ${index} ("${headerAt}") เป็นของฟิลด์ ${owner}`
  }

  const resolveOne = (field: CoreField): number => {
    const spec = COLUMNS[field]
    const hits = firstNameMatch(spec.names)
    // Several columns share the name: the declared index is the tie-break (see fiveSignsAnswer).
    if (hits.length > 0) return hits.includes(IDX[field]) ? IDX[field] : hits[0]
    const refusal = indexRefusal(field, IDX[field])
    if (refusal !== null) {
      warn(field, `หาจากชื่อหัวตารางไม่พบ และ${refusal} — ข้ามคอลัมน์นี้ (ค่าว่าง)`)
      return -1
    }
    if (!spec.silentFallback) warn(field, `หาจากชื่อหัวตารางไม่พบ — ใช้ตำแหน่งคอลัมน์ที่ ${IDX[field]} แทน`)
    return IDX[field]
  }

  /**
   * Flag factors resolve to a SET of columns: the pre-refresh schema split 'ขาดยา/ไม่มาตามนัด'
   * across two columns and both OR into the one factor, so every matching name counts here
   * (unlike resolveOne, which picks a single column).
   */
  const resolveFlag = (field: string, names: string[], index: number): number[] => {
    const all = new Set<number>()
    for (const n of names) (byName.get(collapseWs(n)) ?? []).forEach((i) => all.add(i))
    if (all.size > 0) return Array.from(all).sort((a, b) => a - b)
    const refusal = indexRefusal(field, index)
    if (refusal !== null) {
      warn(field, `หาจากชื่อหัวตารางไม่พบ และ${refusal} — ปัจจัยนี้นับเป็น 0 ทั้งหมด`)
      return []
    }
    warn(field, `หาจากชื่อหัวตารางไม่พบ — ใช้ตำแหน่งคอลัมน์ที่ ${index} แทน`)
    return [index]
  }

  const core = {} as Record<CoreField, number>
  ;(Object.keys(COLUMNS) as CoreField[]).forEach((k) => {
    core[k] = resolveOne(k)
  })

  return {
    core,
    risk: RISK_KEYWORDS.map((f) => resolveFlag(`risk:${f.key}`, f.headers, f.index)),
    signs: SIGN_KEYWORDS.map((f) => resolveFlag(`sign:${f.key}`, f.headers, f.index)),
  }
}

function toNumberOrZero(raw: string): number {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return 0
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Suicide location merge, SPEC 4.6: the market/shop category is spelled three different ways in
 * the sheet — 'ตลาด / ร้านค้า' (7 rows), 'ตลาดร้านค้า' (1) and the spaceless 'ตลาด/ร้านค้า' (2).
 * The original two-literal test missed the third, so the สถานที่เกิดเหตุ chart (deck slide 20)
 * drew TWO look-alike categories, 8 and 2, for one place — and with a top-5 cut the split could
 * push the real rank order around. Compare with the separators themselves removed (whitespace AND
 * the slash — 'ตลาด / ร้านค้า', 'ตลาด/ร้านค้า' and 'ตลาดร้านค้า' all reduce to one key) rather
 * than listing spellings, so a fourth punctuation variant cannot reopen the same bug. The merge
 * table stays an explicit allow-list of exactly one entry, so two genuinely different categories
 * that happen to differ only by a slash can never be collapsed by accident.
 */
const SUICIDE_LOCATION_MERGES: { canonical: string; squashed: string }[] = [
  { canonical: 'ตลาด / ร้านค้า', squashed: 'ตลาดร้านค้า' },
]

function mergeSuicideLocation(raw: string): string {
  const squashed = collapseDoubledMarks(raw).replace(/[\s/]+/g, '')
  const hit = SUICIDE_LOCATION_MERGES.find((m) => m.squashed === squashed)
  return hit ? hit.canonical : raw
}

/** Flag semantics (deck slides 13-14): the factor applies iff its own cell carries a value. */
function isFlagCell(v: string): boolean {
  return !isBlankCell(v)
}

/** First resolved column of a factor as raw text ('' when the factor has no column here). */
function factorCell(row: string[], cols: number[]): string {
  for (const c of cols) {
    const v = cell(row, c)
    if (v !== '') return v
  }
  return cols.length > 0 ? cell(row, cols[0]) : ''
}

function compileKeywordsRegex(keywords: string[]): RegExp | null {
  if (!keywords || keywords.length === 0) return null
  const pattern = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(pattern)
}

const RISK_REGEXES = RISK_KEYWORDS.map((f) => compileKeywordsRegex(f.keywords))
const SIGN_REGEXES = SIGN_KEYWORDS.map((f) => compileKeywordsRegex(f.keywords))

/** Parses rows[0] as header + rows[1..] as data. Blank/all-empty rows are skipped. */
export function parseSheet2(rows: string[][]): SLEvent[] {
  if (rows.length === 0) return []
  const res = buildResolver(rows[0])
  const idx = res.core

  const events: SLEvent[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c) => (c ?? '').trim() === '')) continue

    const headline = cell(row, idx.headline)
    const provinceRaw = cell(row, idx.province)
    // Row must contain Social Listening data (matches Site 2 isHumanDataPresent logic).
    // This safely skips Section 2 (ภัยอื่นๆ) and MCATT rows when parsing the unified wide sheet.
    if (!provinceRaw && !headline) continue

    const month = parseMonth(cell(row, idx.month))
    const year = parseYear(cell(row, idx.year))
    const ageRaw = cell(row, idx.age)
    const age = parseAge(ageRaw)
    const severityRaw = cell(row, idx.severity)

    const riskCells = res.risk.map((cols) => factorCell(row, cols))
    const signCells = [...res.signs.map((cols) => factorCell(row, cols)), cell(row, idx.noSymptoms)]

    // Primary path: the column IS the flag. Fallback path (old free-text schema, where a factor's
    // column does not exist): scan the joined risk+sign text for that factor's keywords.
    let scanTextMemo: string | null = null
    const getScanText = (): string => {
      if (scanTextMemo === null) {
        scanTextMemo = [...riskCells, ...signCells]
          .map((c) => c.trim())
          .filter((c) => c !== '' && c !== '-')
          .join(' ')
      }
      return scanTextMemo
    }

    const flagOf = (cols: number[], regex: RegExp | null): boolean => {
      if (cols.length > 0) return cols.some((c) => isFlagCell(cell(row, c)))
      return regex ? regex.test(getScanText()) : false
    }

    const province = normProvince(provinceRaw)
    const patientClass = cell(row, idx.patientClass)

    events.push({
      zone: zoneOf(province, cell(row, idx.zone)),
      month,
      year,
      sortKey: sortKeyOf(month, year),
      monthLabel: monthLabel(month, year),

      province,
      headline,
      link: cell(row, idx.link),

      severity: severityOf(severityRaw),
      severityRaw,

      reporting: cell(row, idx.reporting),

      gender: normGender(cell(row, idx.gender)),
      ageRaw,
      age,
      ageBand: ageBandOf(age),

      suicideAgeGroup: normSuicideAgeGroup(cell(row, idx.suicideAgeGroup)),
      diagnosis: cell(row, idx.diagnosis),
      patientGroup: cell(row, idx.patientGroup),
      patientClass,
      patientStatus: normPatientStatus(patientClass),
      treatmentHistory: cell(row, idx.treatmentHistory),
      suicide: cell(row, idx.suicide),
      suicideMethod: cell(row, idx.suicideMethod),
      suicideCause: cell(row, idx.suicideCause),
      suicideLocation: mergeSuicideLocation(cell(row, idx.suicideLocation)),

      injured: toNumberOrZero(cell(row, idx.injured)),
      deaths: toNumberOrZero(cell(row, idx.deaths)),

      // collapseDoubledMarks for the same reason as province/gender/ช่วงอายุ/ประเภทผู้ป่วย:
      // the sheet has one 'เสีียชีวิต' (doubled สระอี) that would otherwise split off from the
      // 110 'เสียชีวิต' rows. This column was the only categorical field not getting the
      // treatment — an inconsistency, not a deliberate exemption.
      assistance: collapseDoubledMarks(cell(row, idx.assistance)),
      riskCells,
      signCells,
      riskFlags: RISK_KEYWORDS.map((_, fi) => flagOf(res.risk[fi], RISK_REGEXES[fi])),
      signFlags: SIGN_KEYWORDS.map((_, fi) => flagOf(res.signs[fi], SIGN_REGEXES[fi])),
      // collapseDoubledMarks: the col-29 variant of this column has 2 rows spelled 'ไม่่มี'.
      fiveSignsAnswer: collapseDoubledMarks(cell(row, idx.fiveSignsAnswer)),
    })
  }
  return events
}
