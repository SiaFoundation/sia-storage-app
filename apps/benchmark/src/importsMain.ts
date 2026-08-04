import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import { ImportScanner } from '@siastorage/core/services/importScanner'
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { capturePlans } from './explain'
import { generateImportsDataset, IMPORTS_PROFILES, seedLibraryFiles } from './importsDataset'
import { buildImportQuerySpecs } from './importsQueries'
import { writeReport } from './report'
import { runBenchmark } from './runner'
import { createStubAppService } from './stubApp'
import type { BenchmarkReport, DatasetInfo } from './types'

/*
 * The imports benchmark: seed a device-sized library with an import mid-drain,
 * then measure the queries the Imports screen and folder banner run against it,
 * and capture the plan of every statement they issue. Separate from the
 * 1M-record main benchmark so the seed stays in seconds.
 *
 * One snapshot of whatever is checked out. Comparing releases means running it
 * at two commits and diffing the reports by hand.
 *
 * Run: bun run bench:imports [--profile drain|archive100k]
 */

async function main() {
  const args = process.argv.slice(2)
  const profileIdx = args.indexOf('--profile')
  const profileName = profileIdx >= 0 ? args[profileIdx + 1] : 'drain'
  const profile = IMPORTS_PROFILES[profileName]
  if (!profile) {
    console.error(
      `Unknown profile "${profileName}". Options: ${Object.keys(IMPORTS_PROFILES).join(', ')}`,
    )
    process.exit(1)
  }

  console.log(`\n=== Imports benchmark: ${profile.name} ===`)
  console.log(`${profile.description}\n`)

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-bench-imports-'))
  const dbPath = path.join(tempDir, 'bench.db')

  const db = createBetterSqlite3Database(dbPath)
  await runMigrations(db, sortMigrations(coreMigrations))

  const genStart = performance.now()
  console.log(`Seeding ${profile.libraryFiles.toLocaleString()} library files...`)
  const objects = await seedLibraryFiles(db, profile.libraryFiles)
  console.log('Seeding imports...')
  const { info, allImportIds } = await generateImportsDataset(db, profile)
  const generationTimeMs = Math.round(performance.now() - genStart)
  console.log(
    `Seeded ${info.importCount} imports / ${info.importFileCount.toLocaleString()} import_files in ${(generationTimeMs / 1000).toFixed(1)}s`,
  )

  // The node adapter opens WAL; the app's device default is DELETE, and the
  // journal mode shapes exactly the write-interleaved costs measured here.
  await db.execAsync('PRAGMA journal_mode = DELETE')

  const { service: app } = createStubAppService(db)

  // The real scanner, resolved against nothing: every source reports a fixed
  // uri and the stub fsIO moves no bytes, so a tick issues its true DB traffic
  // without any I/O to drown it out.
  const scanner = new ImportScanner()
  scanner.initialize(
    app,
    async () => 'bench-content-hash',
    async () => null,
    async () => ({ status: 'resolved', uri: 'file:///bench/source.bin' }),
  )

  const specs = buildImportQuerySpecs(app, db, allImportIds, scanner)

  const datasetInfo: DatasetInfo = {
    totalRecords: profile.libraryFiles + info.importFileCount,
    currentFiles: profile.libraryFiles,
    directories: 10,
    tags: 0,
    objectsPopulated: objects,
    fsPopulated: 0,
    generationTimeMs,
    importCount: info.importCount,
    importFileCount: info.importFileCount,
  }

  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const outputDir = path.join(thisDir, '..', 'results')

  function buildReport(label: string, results: BenchmarkReport['results']): BenchmarkReport {
    return {
      approach: label,
      timestamp: new Date().toISOString(),
      dataset: datasetInfo,
      environment: {
        platform: `${os.platform()} ${os.arch()}`,
        runtime: `node ${process.version}`,
      },
      results,
    }
  }

  await db.execAsync('ANALYZE')
  writeReport(buildReport(profile.name, await runBenchmark(specs)), outputDir)

  const plans = await capturePlans(db, specs)
  console.log(`\nQuery plans (${plans.length} statements):`)
  for (const p of plans) console.log(`  ${p.spec}: ${p.plan.join(' | ')}`)
  fs.writeFileSync(
    path.join(outputDir, `plans-${profile.name}.json`),
    JSON.stringify(plans, null, 2),
  )

  db.close()
  fs.rmSync(tempDir, { recursive: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
