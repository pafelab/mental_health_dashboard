// Choropleth map of Thailand (SPEC 6.1 widget 5 / SPEC 6.2 widget 2 / SPEC 6.4 item 2).
// Modern design matching Mental Health Dashboard (standalone).html:
// - PIECEWISE colour tiers with an HTML legend card ("เกณฑ์จำแนกสี"). Deck slide 12 asks for
//   explicit, readable class breaks ("เพิ่มเกณฑ์ตรงแผนที่ ตาม รูปนี้") and slide 22 repeats it for
//   Section 2 ("สีด้วยนะ บอกระดับ"). The old continuous visualMap bar could only be read as
//   "darker = more" with no stated thresholds, so it is gone.
// - Clean white province borders (#FFFFFF, 0.8px)
// - Sleek neutral slate base (#EDF1F6) with high-contrast hover (#1E293B)
// - layoutSize 94% (there is no roam/zoom: the outline is height-bound at every width used here)
// - Optional companion side cards (Selected Area + Top 10 Provinces interactive filter list),
//   framed with the same `headerTone` band as the map card so one widget reads as one widget

import { useEffect, useMemo, useState } from 'react'
import * as echarts from 'echarts'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { MapPin } from 'lucide-react'
import type { CategoryCount } from '@/types'
import { ZONE_PROVINCES, PROVINCE_ZONE, PALETTE } from '@/config'
import { prefersReducedMotion } from './chartOptions'
import DataTable, { summaryText } from './DataTable'
import { TableToggle } from './SwitchableChart'
// eslint-disable-next-line import/no-unresolved
import geoRaw from '@/assets/thailand.json'

const FONT = 'Poppins, Prompt, sans-serif'

interface GeoFeature {
  type: string
  properties: { name: string; nameEn?: string }
  geometry: unknown
}
interface GeoFeatureCollection {
  type: string
  features: GeoFeature[]
}

const geo = geoRaw as unknown as GeoFeatureCollection

const COUNTRY_MAP_NAME = 'thailand'

/** Guards echarts.registerMap against being called twice for the same name. */
const registeredMaps = new Set<string>()

function ensureMapRegistered(name: string, fc: GeoFeatureCollection): void {
  if (registeredMaps.has(name)) return
  echarts.registerMap(name, fc as unknown as Parameters<typeof echarts.registerMap>[1])
  registeredMaps.add(name)
}

function zoneFeatureCollection(zone: number): GeoFeatureCollection {
  const provinces = new Set(ZONE_PROVINCES[zone] ?? [])
  return {
    type: 'FeatureCollection',
    features: geo.features.filter((f) => provinces.has(f.properties.name)),
  }
}

export interface ThailandMapBucket {
  min: number
  /** `null` = open-ended top tier. The piece is then emitted with `gte` only: no `lte` key at all,
   *  never `lte: null` — echarts reads a null bound as a real one and the tier stops matching. */
  max: number | null
  color: string
  label: string
}

/** Colour for a province whose count is 0. Both bucket sets start at min: 1 and provinceCounts()
 *  zero-fills all 77 provinces, so without an explicit out-of-range colour every zero province
 *  would fall through to ECharts' own default grey. This is the map's base areaColor, so a zero
 *  province reads as "no events here", visually identical to the unfilled base.
 *
 *  It stays this neutral slate on purpose. It is the lightest fill on the map — lighter than every
 *  tier of both ramps, so the scale still reads as "darker = more" — and it is the only UNSATURATED
 *  one: the legend's tier-1 swatch is now a real orange-200 / blue-200 (see PALETTE.mapTiers),
 *  which separates it from this grey by chroma, where the old near-white tints did not. Lightening
 *  it further would make the country outline vanish against the white card, since the province
 *  borders are white too. */
const ZERO_COLOR = '#EDF1F6'

/** Deck slide 12 bins, top tier first in the deck's own order (≥ 61 · 46-60 · 31-45 · 16-30 · 1-15).
 *  Stored ascending so index i lines up with PALETTE.mapTiers.section1[i] (light → dark); the
 *  legend reverses them so the heaviest class is listed first, as in the deck. */
export const SECTION1_MAP_BUCKETS: ThailandMapBucket[] = [
  { min: 1, max: 15, color: PALETTE.mapTiers.section1[0], label: '1-15' },
  { min: 16, max: 30, color: PALETTE.mapTiers.section1[1], label: '16-30' },
  { min: 31, max: 45, color: PALETTE.mapTiers.section1[2], label: '31-45' },
  { min: 46, max: 60, color: PALETTE.mapTiers.section1[3], label: '46-60' },
  { min: 61, max: null, color: PALETTE.mapTiers.section1[4], label: '≥ 61' },
]

/** Deck slide 22 bins for the hazard map (≥ 12 · 9-11 · 6-8 · 3-5 · 1-2) — a much smaller range
 *  than Section 1's, which is exactly why the two maps cannot share one scale. */
export const SECTION2_MAP_BUCKETS: ThailandMapBucket[] = [
  { min: 1, max: 2, color: PALETTE.mapTiers.section2[0], label: '1-2' },
  { min: 3, max: 5, color: PALETTE.mapTiers.section2[1], label: '3-5' },
  { min: 6, max: 8, color: PALETTE.mapTiers.section2[2], label: '6-8' },
  { min: 9, max: 11, color: PALETTE.mapTiers.section2[3], label: '9-11' },
  { min: 12, max: null, color: PALETTE.mapTiers.section2[4], label: '≥ 12' },
]

export interface ThailandMapProps {
  mode: 'country' | 'zone'
  zone?: number | 'all'
  data: CategoryCount[]
  buckets?: ThailandMapBucket[]
  title: string
  subtitle?: string
  accent: 's1' | 's2'
  onProvinceClick?: (province: string) => void
  selectedProvince?: string
  onClearProvince?: () => void
  topProvinces?: CategoryCount[]
  height?: number
  showSideCards?: boolean
  takeaway?: string
  /** Comparison baseline: the same period + non-geographic filters, WITHOUT the geographic
   *  restriction that produced `data` (audit UX-01). Percentages are computed against this. */
  baselineTotal?: number
  /** Human name of that baseline scope, e.g. 'ทั้งประเทศ' or 'เขตสุขภาพที่ 8'. */
  baselineLabel?: string
  /** Deck slide 9 — 'brand' fills the card's title row with the deep blue band, matching what
   *  Card.tsx does for every other widget. This card is hand-rolled (it is not a <Card>), so the
   *  band classes are mirrored below rather than inherited. Defaults to the plain white header. */
  headerTone?: 'plain' | 'brand'
}

/** Unit disclosure (audit UX-10): these maps plot raw event counts, never a population-adjusted
 *  rate. It used to live in `visualMap.text`; the visualMap is now hidden in favour of the HTML
 *  legend, and the "เกณฑ์จำแนกสี" legend card is its single visible host — the card header does
 *  NOT repeat it. Two other copies are deliberate and not duplication of the same surface: the
 *  plot container's aria-label, which is the only version a screen-reader user gets, and — in the
 *  table view — the DataTable caption, which is that table's own accessible name. */
const UNIT_NOTE = 'หน่วย: จำนวนเหตุการณ์ (ไม่ได้ปรับตามประชากร)'

/**
 * responsive-audit R07: the map's height in px, stepping with the viewport the same way the old
 * `min-h-[640px] lg:min-h-[740px]` classes did — except the base is 360px, not 640px, so the map
 * no longer fills a whole phone screen before the province ranking and event table.
 *
 * It has to be a NUMBER, not `height: 100%`: ECharts sizes its canvas from the container's
 * clientHeight at init, and a percentage height inside an auto-height flex column resolves to
 * zero — measured exactly that (a 0x0 canvas at 375px wide) when this was left to CSS alone.
 */
const MAP_HEIGHT_STEPS: { mq: string; px: number }[] = [
  { mq: '(min-width: 1024px)', px: 740 },
  { mq: '(min-width: 768px)', px: 560 },
  { mq: '(min-width: 640px)', px: 460 },
]
const MAP_HEIGHT_BASE = 360

function pickMapHeight(): number {
  if (typeof window === 'undefined' || !window.matchMedia) return MAP_HEIGHT_STEPS[0].px
  return MAP_HEIGHT_STEPS.find((s) => window.matchMedia(s.mq).matches)?.px ?? MAP_HEIGHT_BASE
}

function useMapHeight(explicit?: number): number {
  const [height, setHeight] = useState<number>(() => explicit ?? pickMapHeight())
  useEffect(() => {
    if (explicit) return
    const update = () => setHeight(pickMapHeight())
    const lists = MAP_HEIGHT_STEPS.map((s) => window.matchMedia(s.mq))
    lists.forEach((l) => l.addEventListener('change', update))
    update()
    return () => lists.forEach((l) => l.removeEventListener('change', update))
  }, [explicit])
  return explicit ?? height
}

export default function ThailandMap(p: ThailandMapProps): JSX.Element {
  const isZoneScoped = p.mode === 'zone' && typeof p.zone === 'number'

  // Register (once) and pick the map name + province count for the current scope.
  const { mapName, provinceCount } = useMemo(() => {
    if (isZoneScoped) {
      const zoneNum = p.zone as number
      const name = `zone-${zoneNum}`
      ensureMapRegistered(name, zoneFeatureCollection(zoneNum))
      return { mapName: name, provinceCount: (ZONE_PROVINCES[zoneNum] ?? []).length }
    }
    ensureMapRegistered(COUNTRY_MAP_NAME, geo)
    return { mapName: COUNTRY_MAP_NAME, provinceCount: geo.features.length }
  }, [isZoneScoped, p.zone])

  const totalCount = useMemo(
    () => p.data.reduce((acc, d) => acc + (Number.isFinite(d.value) ? d.value : 0), 0),
    [p.data],
  )

  const top10 = useMemo(
    () => (p.topProvinces ?? [...p.data].sort((a, b) => b.value - a.value)).slice(0, 10),
    [p.topProvinces, p.data],
  )

  /**
   * SocialListeningSection does NOT pass `buckets` (Section 2's OtherHazardsSection does), so the
   * fallback has to be resolved here or Section 1's map would render with no pieces at all and
   * lose every fill. Both fallbacks are module constants, so no memo is needed — but `buckets`
   * DOES belong in the option's dependency list below, or a change of bin set never repaints.
   */
  const buckets = p.buckets ?? (p.accent === 's1' ? SECTION1_MAP_BUCKETS : SECTION2_MAP_BUCKETS)

  const option = useMemo<EChartsOption>(() => {
    return {
      textStyle: { fontFamily: FONT },
      animation: !prefersReducedMotion(),
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { fontFamily: FONT, fontSize: 14, color: '#1E293B' },
        extraCssText:
          'box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.1); border-radius: 12px;',
        formatter: (params: any) => {
          const value = typeof params.value === 'number' ? params.value : 0
          return `<div style="font-weight:700;font-size:15px;color:#0F172A;margin-bottom:2px">${params.name}</div><div style="font-size:13px;color:#64748B">${value.toLocaleString('en-US')} เหตุการณ์</div>`
        },
      },
      visualMap: {
        type: 'piecewise',
        // `show: false` on purpose: the classes are published as a real HTML legend card next to
        // the plot (see `legendCard` below) instead of as canvas text. The canvas legend could not
        // be read by assistive tech — the plot container is a single role="img" — and could not
        // spell out "เหตุการณ์" on every row without overflowing the map.
        show: false,
        // `gte`/`lte`, NOT the legacy `min`/`max` pair. PiecewiseModel reopens a `min` bound as
        // soon as the piece has no upper bound (`useMinMax[0] && interval[1] === Infinity &&
        // (close_1[0] = 0)`), so `{ min: 61 }` matches 61 < v, not 61 ≤ v: a province with exactly
        // 61 events (or exactly 12 on the Section 2 scale) would match NO piece and be painted the
        // out-of-range ZERO_COLOR while the legend beside it claims "≥ 61 เหตุการณ์".
        // `gte`/`lte` are always closed, so the bins tile the integers with no gap: 15 ends tier 1,
        // 16 opens tier 2, and the top tier simply omits `lte` to stay open-ended.
        pieces: buckets.map((b) =>
          b.max === null
            ? { gte: b.min, color: b.color, label: b.label }
            : { gte: b.min, lte: b.max, color: b.color, label: b.label },
        ),
        // provinceCounts() zero-fills all 77 provinces and every piece starts at 1, so without
        // this each 0-value province would fall outside the pieces and pick up echarts' default
        // out-of-range style. Painted as the base areaColor = "no events reported here".
        outOfRange: { color: ZERO_COLOR },
      },
      series: [
        {
          name: p.title,
          type: 'map',
          map: mapName,
          roam: false,
          layoutCenter: ['50%', '50%'],
          // Re-checked after the sidebar removal widened this container by ~256px: a percentage
          // layoutSize resolves against the SMALLER of the container's two dimensions, and
          // Thailand's outline is far taller than it is wide, so the map is height-bound at every
          // width the dashboard actually uses. Extra container width therefore becomes horizontal
          // margin and never clips — raising this number would not fill it, only crop the coast.
          // That empty margin is deliberately NOT used to float the legend: when the map shares a
          // row with the side cards it is only ~620px wide at lg and the margins collapse to a
          // couple of dozen px, so an overlaid legend would sit on top of the provinces.
          layoutSize: '94%',
          label: { show: false },
          itemStyle: {
            areaColor: '#EDF1F6',
            borderColor: '#FFFFFF',
            borderWidth: 0.8,
          },
          emphasis: {
            itemStyle: { areaColor: '#1E293B' },
            label: { show: false },
          },
          select: {
            itemStyle: { areaColor: '#1E293B' },
            label: { show: false },
          },
          data: p.data.map((d) => ({
            name: d.name,
            value: d.value,
            selected: p.selectedProvince ? d.name === p.selectedProvince : false,
          })),
        },
      ],
    }
  }, [mapName, buckets, p.data, p.selectedProvince, p.title])

  const onEvents = useMemo(
    () => ({
      click: (params: any) => {
        if (params?.componentType === 'series' && typeof params.name === 'string' && p.onProvinceClick) {
          if (p.selectedProvince && p.selectedProvince === params.name && p.onClearProvince) {
            p.onClearProvince()
          } else {
            p.onProvinceClick(params.name)
          }
        }
      },
    }),
    [p.onProvinceClick, p.onClearProvince, p.selectedProvince],
  )

  const subtitle = p.subtitle ?? (p.mode === 'country' ? 'ใช้เลือกพื้นที่ · คลิกจังหวัดเพื่อกรองทุกการ์ดในหน้านี้' : `${provinceCount} จังหวัด`)

  /** Compares the two leading provinces using the values actually plotted (audit UX-10):
   *  no hard-coded geography claim, and the exact difference + ratio instead of "เกือบสองเท่า". */
  const rankingSentence = useMemo(() => {
    const top1 = top10[0]
    const top2 = top10[1]
    if (!top1 || top1.value <= 0) return ''
    const head = `${top1.name} ${top1.value.toLocaleString()} เหตุการณ์`
    if (!top2 || top2.value <= 0) return `${head} สูงสุดในขอบเขตที่เลือก`
    const other = `${top2.name} (${top2.value.toLocaleString()} เหตุการณ์)`
    if (top1.value === top2.value) return `${head} เท่ากับ${other}`
    const diff = top1.value - top2.value
    const ratio = (top1.value / top2.value).toFixed(1)
    return `${head} มากกว่า${other} อยู่ ${diff.toLocaleString()} เหตุการณ์ (${ratio} เท่า)`
  }, [top10])

  const takeawayText = useMemo(() => {
    if (p.takeaway) return p.takeaway
    if (p.selectedProvince) {
      return `กำลังแสดงข้อมูลเฉพาะ ${p.selectedProvince} (คลิกจังหวัดอีกครั้งหรือกดปุ่มล้างเพื่อแสดงทั้งหมด)`
    }
    if (p.mode === 'country') {
      return rankingSentence || 'ใช้เลือกพื้นที่ · คลิกจังหวัดเพื่อกรองทุกการ์ดในหน้านี้'
    }
    // zone mode with zone === 'all' aggregates the whole country, so the narrative must not claim
    // a single health zone (audit UX-10: stated scope has to match the actual aggregation).
    const scopeName = isZoneScoped ? `เขตสุขภาพที่ ${p.zone}` : 'ทั้งประเทศ'
    const zoneHead = `${scopeName} ครอบคลุม ${provinceCount} จังหวัด รวม ${totalCount.toLocaleString()} เหตุการณ์`
    return rankingSentence ? `${zoneHead} · ${rankingSentence}` : zoneHead
  }, [
    p.takeaway,
    p.selectedProvince,
    p.mode,
    p.zone,
    isZoneScoped,
    provinceCount,
    rankingSentence,
    totalCount,
  ])

  /** Scope the percentage is measured against — never the already-filtered total, which would
   *  always render a selected province as 100% (audit UX-01). */
  const baselineLabel = p.baselineLabel ?? (p.mode === 'zone' ? 'เขต' : 'ทั้งประเทศ')

  const dataMap = useMemo(
    () => new Map(p.data.map((d) => [d.name, d.value])),
    [p.data],
  )

  const selectedInfo = useMemo(() => {
    if (!p.selectedProvince) return null
    const val = dataMap.get(p.selectedProvince) ?? 0
    const zoneNum = PROVINCE_ZONE[p.selectedProvince] !== undefined ? String(PROVINCE_ZONE[p.selectedProvince]) : '-'
    const base = p.baselineTotal
    const hasBase = typeof base === 'number' && Number.isFinite(base) && base > 0
    const pct = hasBase ? ((val / (base as number)) * 100).toFixed(1) : null
    return { name: p.selectedProvince, value: val, zoneNum, pct }
  }, [p.selectedProvince, dataMap, p.baselineTotal])

  /** What the unselected count actually covers: the map's own scope, which is narrower than the
   *  baseline whenever a zone filter is applied (audit UX-01: state the comparison scope). */
  const scopeLabel =
    p.mode === 'zone' && typeof p.zone === 'number'
      ? `เขตสุขภาพที่ ${p.zone}`
      : totalCount === p.baselineTotal
      ? baselineLabel
      : p.baselineTotal === undefined
      ? 'ทั้งประเทศ'
      : 'ขอบเขตที่เลือก'
  const showBaselineLine =
    typeof p.baselineTotal === 'number' && Number.isFinite(p.baselineTotal) && p.baselineTotal !== totalCount

  const maxProvVal = top10[0]?.value || 1
  const chartHeight = useMapHeight(p.height)

  // UX-13 — the choropleth needs an equivalent numerical table, available on every map card
  // (including section 2's, which has no companion top-10 list).
  const [showTable, setShowTable] = useState(false)
  const tableRows = useMemo(() => [...p.data].sort((a, b) => b.value - a.value), [p.data])
  const tableCategories = useMemo(() => tableRows.map((d) => d.name), [tableRows])
  const tableSeries = useMemo(
    () => [{ name: 'จำนวน', values: tableRows.map((d) => d.value) }],
    [tableRows],
  )
  const tableSummary = useMemo(
    () => summaryText({ categories: tableCategories, series: tableSeries, unit: 'เหตุการณ์' }),
    [tableCategories, tableSeries],
  )

  /**
   * Deck slide 12 / slide 22 — the class breaks, published as real HTML.
   *
   * It is a SIBLING of the plot container, never a child: that div carries role="img" with a
   * single aria-label, so anything nested inside it is invisible to assistive tech. It is also
   * not one of the optional side cards — Section 2 never passes `showSideCards`, so a side-card
   * legend would appear on Section 1 only — and it renders in the table branch too, where the
   * colours still explain the map the reader just switched away from.
   */
  const legendCard = (
    <div className="px-4 pb-5 sm:px-6 flex-none">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-bold text-slate-800">เกณฑ์จำแนกสี</p>
        <p className="mt-0.5 text-xs text-slate-600">{UNIT_NOTE}</p>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {/* Heaviest class first, matching the deck's own ordering. */}
          {[...buckets].reverse().map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <span
                className="h-4 w-4 shrink-0 rounded border border-slate-300"
                style={{ backgroundColor: b.color }}
                aria-hidden="true"
              />
              <span className="text-sm text-slate-700 tabular-nums whitespace-nowrap">
                {b.label} เหตุการณ์
              </span>
            </li>
          ))}
          {/* provinceCounts() zero-fills every province, so "0" is a real class on this map and
              has to be named — otherwise the palest tier reads as "nothing here". */}
          <li className="flex items-center gap-2">
            <span
              className="h-4 w-4 shrink-0 rounded border border-slate-300"
              style={{ backgroundColor: ZERO_COLOR }}
              aria-hidden="true"
            />
            <span className="text-sm text-slate-700 tabular-nums whitespace-nowrap">0 เหตุการณ์</span>
          </li>
        </ul>
      </div>
    </div>
  )

  const banded = p.headerTone === 'brand'

  const mapCard = (
    <div className="bg-white rounded-card shadow-card overflow-hidden h-full flex flex-col">
      {/* responsive-audit R01: same wrapping header as Card.tsx — title never clipped.
          Deck slide 9: `headerTone="brand"` mirrors Card.tsx's bg-s2-700 band, including the
          white tile behind the toggle — TableToggle's unpressed state is slate-on-transparent and
          would be unreadable directly on the fill. */}
      <div
        className={`flex flex-wrap items-start justify-between gap-3 px-6 flex-none ${
          banded ? 'bg-gradient-to-r from-s1-600 to-s1-700 py-4' : 'pt-5 pb-2'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`shrink-0 grid place-items-center w-10 h-10 rounded-xl ${
              banded
                ? 'bg-white/20 text-white'
                : p.accent === 's1'
                ? 'bg-orange-100 text-orange-600'
                : 'bg-blue-100 text-blue-600'
            }`}
            aria-hidden="true"
          >
            <MapPin size={20} strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h3
              className={`font-sans font-bold text-cardTitle leading-snug ${
                banded ? 'text-white' : 'text-slate-800'
              }`}
            >
              {p.title}
            </h3>
            <p className={`text-sm mt-0.5 ${banded ? 'text-white/85' : 'text-slate-500'}`}>{subtitle}</p>
            {/* No UNIT_NOTE here: the legend card below is its host (see UNIT_NOTE's docstring).
                It used to render in both places, one screenful apart. */}
          </div>
        </div>
        {tableRows.length > 0 && (
          <div className={`ml-auto flex-none ${banded ? 'rounded-xl bg-white/95 p-1' : ''}`}>
            <TableToggle
              pressed={showTable}
              onToggle={() => setShowTable((v) => !v)}
              accent={p.accent}
            />
          </div>
        )}
      </div>
      {takeawayText && (
        <p className="px-6 pt-1 pb-1 text-[15px] sm:text-base text-slate-600 leading-relaxed max-w-[75ch] flex-none">
          {takeawayText}
        </p>
      )}
      {showTable ? (
        <>
          <div className="px-4 pb-4 sm:px-6 flex-1">
            <DataTable
              caption={`${p.title} · ${UNIT_NOTE}`}
              categories={tableCategories}
              series={tableSeries}
              categoryHeader="จังหวัด"
              maxHeight={chartHeight}
            />
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{tableSummary}</p>
          </div>
          {legendCard}
        </>
      ) : (
        /* responsive-audit R07: the base rule used to reserve 640px of map (680px of canvas) on
           every screen below lg, so on a 568px-tall phone the map alone was taller than the
           viewport and pushed the province ranking and the event table out of reach. Both the box
           and the canvas now take the same stepped height from useMapHeight; the ranking list and
           the จังหวัด filter remain the non-map ways to pick a province. */
        <>
          <div
            className="px-3 pb-2 sm:px-4 sm:pb-3 flex-1 flex flex-col"
            style={{ minHeight: chartHeight }}
            role="img"
            aria-label={`${p.title} แผนภูมิแผนที่ · ${UNIT_NOTE}`}
          >
            <ReactECharts
              option={option}
              onEvents={onEvents}
              style={{ height: chartHeight, width: '100%' }}
              notMerge
              lazyUpdate
            />
          </div>
          {legendCard}
        </>
      )}
    </div>
  )

  if (!p.showSideCards) {
    return mapCard
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      {/* Main Map Card */}
      <div className="lg:col-span-2 min-w-0 flex flex-col">{mapCard}</div>

      {/* Side Companion Cards */}
      <div className="lg:col-span-1 min-w-0 flex flex-col gap-6">
        {/* Card 1: พื้นที่ที่เลือก — banded from the SAME `banded` flag as the map beside it, so
            the widget is framed alike end to end (deck slide 9). The plain branch is the original
            white header, kept for callers that do not pass headerTone. */}
        <div className="bg-white rounded-card shadow-card overflow-hidden">
          <div
            className={`flex items-baseline justify-between gap-3 px-6 ${
              banded ? 'bg-gradient-to-r from-s1-600 to-s1-700 py-4' : 'pt-6 pb-0'
            }`}
          >
            <h3 className={`font-sans font-bold text-lg ${banded ? 'text-white' : 'text-slate-800'}`}>
              พื้นที่ที่เลือก
            </h3>
            {p.selectedProvince && p.onClearProvince && (
              <button
                type="button"
                onClick={p.onClearProvince}
                aria-label={`ล้างจังหวัดที่เลือก (${p.selectedProvince})`}
                className={`rounded text-sm font-semibold hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  banded
                    ? // A white ring on the orange band.
                      'text-white/90 hover:text-white focus-visible:ring-white focus-visible:ring-offset-s1-700'
                    : p.accent === 's1'
                    ? 'text-s1-700 hover:text-s1-800 focus-visible:ring-slate-600'
                    : 'text-s2-600 hover:text-s2-700 focus-visible:ring-slate-600'
                }`}
              >
                ล้าง
              </button>
            )}
          </div>
          <div className="px-6 pb-6 pt-3">
            {selectedInfo ? (
              <div>
                <p className="text-xl font-bold text-slate-800">{selectedInfo.name}</p>
                <p className="text-sm text-slate-500 mt-0.5">เขตสุขภาพที่ {selectedInfo.zoneNum}</p>
                <div className="flex items-baseline gap-2 mt-3">
                  <span
                    className={`text-4xl font-extrabold leading-none ${
                      p.accent === 's1' ? 'text-s1-600' : 'text-s2-600'
                    }`}
                  >
                    {selectedInfo.value.toLocaleString()}
                  </span>
                  {selectedInfo.pct !== null ? (
                    <span className="text-sm text-slate-600">
                      เหตุการณ์ · {selectedInfo.pct}% ของ{baselineLabel}ในช่วงเวลาเดียวกัน
                    </span>
                  ) : (
                    <span
                      className="text-sm text-slate-600"
                      title="ไม่สามารถคำนวณสัดส่วนได้ (ไม่มีฐานเปรียบเทียบ)"
                    >
                      เหตุการณ์ · สัดส่วนของ{baselineLabel} —
                    </span>
                  )}
                </div>
                {selectedInfo.pct === null && (
                  <p className="mt-1 text-sm text-slate-600">
                    ไม่สามารถคำนวณสัดส่วนได้ (ไม่มีฐานเปรียบเทียบ)
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-slate-800 text-[17px]">
                  {scopeLabel} · <b className="font-bold">{totalCount.toLocaleString()}</b> เหตุการณ์
                </p>
                {showBaselineLine && (
                  <p className="mt-1 text-sm text-slate-600">
                    จาก{baselineLabel} {(p.baselineTotal as number).toLocaleString()} เหตุการณ์ในช่วงเวลาเดียวกัน
                  </p>
                )}
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  คลิกจังหวัดบนแผนที่ หรือเลือกจากรายการด้านล่าง เพื่อกรองการ์ดและตารางทั้งหน้า
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: 10 อันดับจังหวัด — same framing as the map and the card above it. Without the
            band this card collided with the identically-titled banded "10 อันดับจังหวัด" card
            elsewhere on the page: two cards, one title, two different frames. */}
        <div className="bg-white rounded-card shadow-card overflow-hidden">
          <div
            className={`flex items-baseline justify-between gap-3 px-6 ${
              banded ? 'bg-gradient-to-r from-s1-600 to-s1-700 py-4' : 'pt-6 pb-2'
            }`}
          >
            <h3 className={`font-sans font-bold text-lg ${banded ? 'text-white' : 'text-slate-800'}`}>
              10 อันดับจังหวัด
            </h3>
            <span className={`text-xs ${banded ? 'text-white/85' : 'text-slate-500'}`}>คลิกเพื่อเลือก</span>
          </div>
          <div className="space-y-1 px-6 pb-6 pt-3">
            {top10.map((prov) => {
              const isSelected = p.selectedProvince === prov.name
              const barPct = Math.round((prov.value / maxProvVal) * 100)
              return (
                <button
                  key={prov.name}
                  type="button"
                  onClick={() => {
                    if (isSelected && p.onClearProvince) {
                      p.onClearProvince()
                    } else {
                      p.onProvinceClick?.(prov.name)
                    }
                  }}
                  aria-pressed={isSelected}
                  className={`w-full text-left rounded-xl px-3 py-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-1 ${
                    isSelected
                      ? p.accent === 's1'
                        ? 'bg-orange-50 ring-1 ring-orange-200'
                        : 'bg-blue-50 ring-1 ring-blue-200'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-sm transition-colors ${
                        isSelected
                          ? p.accent === 's1'
                            ? 'font-bold text-orange-700'
                            : 'font-bold text-blue-700'
                          : 'font-normal text-slate-700'
                      }`}
                    >
                      {prov.name}
                    </span>
                    <span
                      className={`text-sm tabular-nums font-bold ${
                        isSelected
                          ? p.accent === 's1'
                            ? 'text-orange-700'
                            : 'text-blue-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {prov.value.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isSelected
                          ? p.accent === 's1'
                            ? 'bg-orange-600'
                            : 'bg-blue-600'
                          : p.accent === 's1'
                          ? 'bg-orange-300'
                          : 'bg-blue-300'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
