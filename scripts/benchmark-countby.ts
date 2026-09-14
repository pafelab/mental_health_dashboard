import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { performance } from 'perf_hooks'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')

if (!process.env.BENCHMARK_CHILD) {
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (!fs.existsSync(tsxCli)) {
    console.error(`FATAL: cannot find tsx at ${tsxCli}`)
    process.exit(1)
  }
  const child = spawnSync(process.execPath, [tsxCli, '--tsconfig', path.join(ROOT, 'tsconfig.app.json'), SELF], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, BENCHMARK_CHILD: '1' },
  })
  process.exit(child.status ?? 1)
}

const { countBy, impactByPatientGroup } = await import('@/data')
const { CATEGORY_ORDERS } = await import('@/config')

function generateMockRows(count: number, numCategories = 13) {
  const baseCategories = [
    'ผู้ป่วยจิตเวช ',
    '  ผู้ป่วยจิตเวช',
    'ผู้ป่วยจิตเวชใช้สารเสพติด',
    'ผู้ป่วยจิตเวช  จากการใช้สารเสพติด',
    'ผู้ป่วย SMI-V',
    ' มีประวัติใช้สารเสพติด ',
    'ข้อมูลไม่เพียงพอต่อการตรวจสอบ',
    'ไม่พบประวัติ',
  ]

  const categories: string[] = []
  for (let i = 0; i < numCategories; i++) {
    if (i < baseCategories.length) {
      categories.push(baseCategories[i])
    } else {
      categories.push(` Extra Category ${i} `)
    }
  }

  const rows: { category: string; deaths: number; injured: number }[] = []
  for (let i = 0; i < count; i++) {
    const category = categories[i % categories.length]
    rows.push({
      category,
      deaths: (i % 5) + 1,
      injured: (i % 3) + 1,
    })
  }
  return rows
}

function runBenchmark() {
  console.log('--- Benchmarking countBy & impactByPatientGroup ---')

  const rowsSmall = generateMockRows(1_000, 13)
  const rowsMedium = generateMockRows(10_000, 13)
  const rowsLarge = generateMockRows(50_000, 13)

  // Many categories benchmark (10k rows with 200 distinct raw categories, order of 50 items)
  const rowsManyCats = generateMockRows(10_000, 200)
  const order50 = Array.from({ length: 50 }, (_, i) => `Extra Category ${i}`)

  const order7 = CATEGORY_ORDERS.patientGroup7 // 7 categories

  // Warmup
  for (let i = 0; i < 50; i++) {
    countBy(rowsSmall, (r) => r.category, order7)
  }

  // Measure small dataset (1,000 rows, 1,000 iterations)
  const iterationsSmall = 1_000
  const startSmall = performance.now()
  for (let i = 0; i < iterationsSmall; i++) {
    countBy(rowsSmall, (r) => r.category, order7)
  }
  const durationSmall = performance.now() - startSmall

  // Measure medium dataset (10,000 rows, 200 iterations)
  const iterationsMedium = 200
  const startMedium = performance.now()
  for (let i = 0; i < iterationsMedium; i++) {
    countBy(rowsMedium, (r) => r.category, order7)
  }
  const durationMedium = performance.now() - startMedium

  // Measure large dataset (50,000 rows, 50 iterations)
  const iterationsLarge = 50
  const startLarge = performance.now()
  for (let i = 0; i < iterationsLarge; i++) {
    countBy(rowsLarge, (r) => r.category, order7)
  }
  const durationLarge = performance.now() - startLarge

  // Measure many categories dataset (10,000 rows, 200 categories, 50 order items, 200 iterations)
  const startManyCats = performance.now()
  for (let i = 0; i < iterationsMedium; i++) {
    countBy(rowsManyCats, (r) => r.category, order50)
  }
  const durationManyCats = performance.now() - startManyCats

  // Measure impactByPatientGroup
  const impactRows = rowsMedium.map((r) => ({ patientGroup: r.category, deaths: r.deaths, injured: r.injured }))
  const startImpact = performance.now()
  for (let i = 0; i < iterationsMedium; i++) {
    impactByPatientGroup(impactRows)
  }
  const durationImpact = performance.now() - startImpact

  console.log(`Small dataset (1k rows, ${iterationsSmall} iter): ${durationSmall.toFixed(2)} ms (${(durationSmall / iterationsSmall).toFixed(4)} ms/op)`)
  console.log(`Medium dataset (10k rows, ${iterationsMedium} iter): ${durationMedium.toFixed(2)} ms (${(durationMedium / iterationsMedium).toFixed(4)} ms/op)`)
  console.log(`Large dataset (50k rows, ${iterationsLarge} iter): ${durationLarge.toFixed(2)} ms (${(durationLarge / iterationsLarge).toFixed(4)} ms/op)`)
  console.log(`Many categories (10k rows, 200 cats, 50 order items, ${iterationsMedium} iter): ${durationManyCats.toFixed(2)} ms (${(durationManyCats / iterationsMedium).toFixed(4)} ms/op)`)
  console.log(`impactByPatientGroup (10k rows, ${iterationsMedium} iter): ${durationImpact.toFixed(2)} ms (${(durationImpact / iterationsMedium).toFixed(4)} ms/op)`)
}

runBenchmark()
