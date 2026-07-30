import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { generateDataset } from './dataset'
import { buildQuerySpecs, buildWriteQuerySpecs } from './queries'
import { writeReport } from './report'
import { runBenchmark } from './runner'
import { createStubAppService } from './stubApp'
import type { BenchmarkReport, DatasetInfo } from './types'

function buildReport(
  approach: string,
  datasetInfo: DatasetInfo,
  results: Awaited<ReturnType<typeof runBenchmark>>,
): BenchmarkReport {
  return {
    approach,
    timestamp: new Date().toISOString(),
    dataset: datasetInfo,
    environment: {
      platform: `${os.platform()} ${os.arch()}`,
      runtime: `node ${process.version}`,
    },
    results,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const scaleIdx = args.indexOf('--scale')
  const scale = scaleIdx >= 0 ? Number(args[scaleIdx + 1] || 1) : 1
  const approachIdx = args.indexOf('--approach')
  const approach = approachIdx >= 0 ? args[approachIdx + 1] : 'CURRENT_COLUMN'
  const filterIdx = args.indexOf('--filter')
  const filter = filterIdx >= 0 ? args[filterIdx + 1] : null
  const applyFilter = <T extends { name: string }>(specs: T[]): T[] =>
    filter ? specs.filter((s) => s.name.includes(filter)) : specs

  console.log(`\n=== Benchmark: ${approach} (scale ${scale}x) ===\n`)

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-bench-'))
  const dbPath = path.join(tempDir, 'bench.db')
  console.log(`Database: ${dbPath}`)

  const db = createBetterSqlite3Database(dbPath)
  await runMigrations(db, sortMigrations(coreMigrations))

  const datasetInfo = await generateDataset(db, { scale })

  const { service: app } = createStubAppService(db)

  const sampleDirId = 'dir-0025'
  const sampleTagId = 'tag-work'
  const sampleFileId = 'f-500000'

  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const outputDir = path.join(thisDir, '..', 'results')

  // Phase 1: Before ANALYZE
  console.log('\n--- Before ANALYZE ---\n')
  const specsBeforeAnalyze = buildQuerySpecs(app, sampleDirId, sampleTagId, sampleFileId)
  const resultsBeforeAnalyze = await runBenchmark(applyFilter(specsBeforeAnalyze))
  const reportBeforeAnalyze = buildReport(
    `${approach}_before_analyze`,
    datasetInfo,
    resultsBeforeAnalyze,
  )
  writeReport(reportBeforeAnalyze, outputDir)

  // Phase 2: Run ANALYZE + PRAGMA optimize
  console.log('\nRunning ANALYZE...')
  const analyzeStart = performance.now()
  await db.execAsync('ANALYZE')
  await db.execAsync('PRAGMA optimize')
  console.log(`ANALYZE completed in ${((performance.now() - analyzeStart) / 1000).toFixed(1)}s`)

  // Phase 3: After ANALYZE
  console.log('\n--- After ANALYZE ---\n')
  const specsAfterAnalyze = buildQuerySpecs(app, sampleDirId, sampleTagId, sampleFileId)
  const resultsAfterAnalyze = await runBenchmark(applyFilter(specsAfterAnalyze))
  const reportAfterAnalyze = buildReport(
    `${approach}_after_analyze`,
    datasetInfo,
    resultsAfterAnalyze,
  )
  writeReport(reportAfterAnalyze, outputDir)

  // Phase 4: Write benchmarks (after ANALYZE, with rollback per iteration)
  console.log('\n--- Write Benchmarks ---\n')
  const writeSpecs = buildWriteQuerySpecs(db, sampleDirId)
  const writeResults = await runBenchmark(applyFilter(writeSpecs))
  const writeReportData = buildReport(`${approach}_writes`, datasetInfo, writeResults)
  writeReport(writeReportData, outputDir)

  db.close()
  fs.rmSync(tempDir, { recursive: true })

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
