// Zone -> province table. SPEC 4.2.
//
// Source: docs/data/zones.json (lifted from the old site), which is verified to hold
// only 76 provinces — นครพนม is missing from zone 8 (docs/BUILD_NOTES.md "DATA BUG FOUND").
// FIX applied here: นครพนม added to zone 8, giving 77 provinces total.
//
// Verified 2026-09-09: the flattened list below has exactly 77 distinct names and matches
// src/assets/thailand.json's `properties.name` set exactly (same 77 strings, no diff either way).

export const ZONE_PROVINCES: Record<number, string[]> = {
  1: ['เชียงใหม่', 'เชียงราย', 'ลำพูน', 'ลำปาง', 'แม่ฮ่องสอน', 'พะเยา', 'น่าน', 'แพร่'],
  2: ['พิษณุโลก', 'ตาก', 'สุโขทัย', 'อุตรดิตถ์', 'เพชรบูรณ์'],
  3: ['นครสวรรค์', 'กำแพงเพชร', 'อุทัยธานี', 'พิจิตร', 'ชัยนาท'],
  4: ['สระบุรี', 'นนทบุรี', 'ลพบุรี', 'อ่างทอง', 'นครนายก', 'สิงห์บุรี', 'พระนครศรีอยุธยา', 'ปทุมธานี'],
  5: ['นครปฐม', 'สุพรรณบุรี', 'ราชบุรี', 'กาญจนบุรี', 'สมุทรสาคร', 'สมุทรสงคราม', 'เพชรบุรี', 'ประจวบคีรีขันธ์'],
  6: ['สมุทรปราการ', 'ชลบุรี', 'ระยอง', 'จันทบุรี', 'ตราด', 'ฉะเชิงเทรา', 'ปราจีนบุรี', 'สระแก้ว'],
  7: ['ขอนแก่น', 'ร้อยเอ็ด', 'กาฬสินธุ์', 'มหาสารคาม'],
  // นครพนม added — see BUILD_NOTES DATA BUG FOUND.
  8: ['อุดรธานี', 'สกลนคร', 'หนองคาย', 'เลย', 'หนองบัวลำภู', 'บึงกาฬ', 'นครพนม'],
  9: ['นครราชสีมา', 'บุรีรัมย์', 'สุรินทร์', 'ชัยภูมิ'],
  10: ['อุบลราชธานี', 'ศรีสะเกษ', 'ยโสธร', 'อำนาจเจริญ', 'มุกดาหาร'],
  11: ['สุราษฎร์ธานี', 'นครศรีธรรมราช', 'ภูเก็ต', 'กระบี่', 'พังงา', 'ระนอง', 'ชุมพร'],
  12: ['สงขลา', 'สตูล', 'ตรัง', 'พัทลุง', 'ปัตตานี', 'ยะลา', 'นราธิวาส'],
  13: ['กรุงเทพมหานคร'],
}

/**
 * The 13 health-zone numbers, in display order. Shared so the filter bar, the MCATT directory and
 * anything else that enumerates zones cannot drift apart (both used to keep a private copy).
 */
export const ZONE_NUMBERS: number[] = Array.from({ length: 13 }, (_, i) => i + 1)

/**
 * Display label for a zone number — always the full 'เขตสุขภาพที่ N', never the clipped 'เขต N'
 * (review deck slide 10). Display only: zone PARSING (src/data/normalize.ts parseZone and the
 * '?zone=' URL param) is digit-based and is unaffected by this string.
 */
export function formatZoneLabel(zone: number): string {
  return `เขตสุขภาพที่ ${zone}`
}

/** All 77 provinces, in zone order (1..13). Used when zone filter = 'all'. */
export const ALL_PROVINCES: string[] = Object.keys(ZONE_PROVINCES)
  .map(Number)
  .sort((a, b) => a - b)
  .flatMap((zone) => ZONE_PROVINCES[zone])

/**
 * Reverse of ZONE_PROVINCES: canonical province name -> its zone number. Used to derive an
 * event's zone from its (already-normalised) province rather than trust the row's own zone
 * cell verbatim — see src/data/normalize.ts zoneOfProvince() and the verification gate
 * assertion x8b, which caught a real data-entry error in docs/data/1683387958.csv row 402
 * (เขตสุขภาพ = 'เขต 11' but จังหวัด = 'ตรัง', which is a zone-12 province).
 */
export const PROVINCE_ZONE: Record<string, number> = Object.fromEntries(
  Object.entries(ZONE_PROVINCES).flatMap(([zone, provinces]) => provinces.map((p) => [p, Number(zone)])),
)

// Sanity check (verified 2026-09-09, see module comment above) — cheap, so it always runs.
{
  const distinct = new Set(ALL_PROVINCES)
  if (distinct.size !== 77 || ALL_PROVINCES.length !== 77) {
    throw new Error(
      `ZONE_PROVINCES sanity check failed: expected 77 distinct provinces, got ${distinct.size} distinct / ${ALL_PROVINCES.length} total.`,
    )
  }
}

/**
 * Alias -> canonical province name. SPEC 4.2. Copied from site 1's
 * `normalizeProvNameMain` (docs/reference/site1/index.html:493).
 * Applied AFTER stripping `จ.` / `จังหวัด` prefixes (done in src/data/normalize.ts).
 */
export const PROVINCE_ALIASES: Record<string, string> = {
  กทม: 'กรุงเทพมหานคร',
  'กทม.': 'กรุงเทพมหานคร',
  กรุงเทพ: 'กรุงเทพมหานคร',
  กรุงเทพฯ: 'กรุงเทพมหานคร',
  โคราช: 'นครราชสีมา',
  อยุธยา: 'พระนครศรีอยุธยา',
  เมืองคอน: 'นครศรีธรรมราช',
  แปดริ้ว: 'ฉะเชิงเทรา',
  หนองบัวลำพู: 'หนองบัวลำภู',
  ประจวบ: 'ประจวบคีรีขันธ์',
  มหาสารคราม: 'มหาสารคาม',
  // Data-entry typos observed live in ชีต2 col 3 (docs/data/1683387958.csv), verified by the
  // verification gate (assertion x1): 'นตรพนม' (ต instead of ค, 3 rows) and 'ขอนแก่่น' (doubled
  // mai-ek ่ ่, 1 row) never normalise otherwise and were silently dropping off the density map
  // and province filter. See also normProvince() in src/data/normalize.ts, which now also
  // collapses doubled combining marks generically so future typos of the ขอนแก่่น class self-heal.
  นตรพนม: 'นครพนม',
  ขอนแก่่น: 'ขอนแก่น',
}

// eslint-disable-next-line import/no-unresolved
import geoRaw from '@/assets/thailand.json'

interface GeoFeature {
  properties: { name: string; nameEn?: string }
}

/** Official English names for all 77 provinces from thailand.json */
export const PROVINCE_EN: Record<string, string> = Object.fromEntries(
  (geoRaw as unknown as { features: GeoFeature[] }).features
    .filter((f) => f.properties?.name && f.properties?.nameEn)
    .map((f) => [f.properties.name, f.properties.nameEn!]),
)
