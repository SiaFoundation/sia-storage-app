import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import { ImportScanner } from '@siastorage/core/services/importScanner'
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { generateDataset, LIBRARY_SAMPLES, librarySampleFileId } from './dataset'
import { generateImportsDataset, IMPORTS_PROFILES, seedLibraryFiles } from './importsDataset'
import { buildImportQuerySpecs } from './importsQueries'
import { type InstrumentedDatabase, instrumentDatabase } from './instrument'
import { buildQuerySpecs, buildWriteQuerySpecs } from './queries'
import { benchContentHash, createStubAppService } from './stubApp'
import type { DatasetInfo, QuerySpec } from './types'

/*
 * The seeded databases and spec lists the CI comparison runs, one per suite.
 * Each suite seeds its own temporary database, runs ANALYZE the way the app's
 * periodic `PRAGMA optimize` would, and hands back specs bound to an
 * instrumented adapter so the same specs can be timed and have their
 * statements recorded.
 */

export type SuiteOptions = {
  /** Library size multiplier, 1 being about 1M file records. */
  scale: number
}

export type Suite = {
  name: string
  dataset: DatasetInfo
  db: InstrumentedDatabase
  specs: QuerySpec[]
  close(): void
}

export const SUITE_NAMES = ['library', 'imports'] as const
export type SuiteName = (typeof SUITE_NAMES)[number]

async function openDatabase(prefix: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const raw = createBetterSqlite3Database(path.join(tempDir, 'bench.db'))
  await runMigrations(raw, sortMigrations(coreMigrations))
  const db = instrumentDatabase(raw)
  return {
    raw,
    db,
    close() {
      raw.close?.()
      fs.rmSync(tempDir, { recursive: true, force: true })
    },
  }
}

async function librarySuite(options: SuiteOptions): Promise<Suite> {
  const { raw, db, close } = await openDatabase('sia-bench-library-')
  const dataset = await generateDataset(raw, { scale: options.scale })
  await raw.execAsync('ANALYZE')
  await raw.execAsync('PRAGMA optimize')

  const { service: app } = createStubAppService(db)
  const { sampleDirId, sampleTagId } = LIBRARY_SAMPLES
  const specs = [
    ...buildQuerySpecs(app, sampleDirId, sampleTagId, librarySampleFileId(dataset)),
    ...buildWriteQuerySpecs(db, sampleDirId),
  ]
  return { name: 'library', dataset, db, specs, close }
}

async function importsSuite(): Promise<Suite> {
  const profile = IMPORTS_PROFILES.drain
  const { raw, db, close } = await openDatabase('sia-bench-imports-')
  const start = performance.now()
  const objects = await seedLibraryFiles(raw, profile.libraryFiles)
  const { info, allImportIds } = await generateImportsDataset(raw, profile)
  await raw.execAsync('ANALYZE')

  const { service: app } = createStubAppService(db)
  const scanner = new ImportScanner()
  scanner.initialize(
    app,
    async (uri) => benchContentHash(uri),
    async () => null,
    async () => ({ status: 'resolved', uri: 'file:///bench/source.bin' }),
  )

  const dataset: DatasetInfo = {
    totalRecords: profile.libraryFiles + info.importFileCount,
    currentFiles: profile.libraryFiles,
    directories: 10,
    tags: 0,
    objectsPopulated: objects,
    fsPopulated: 0,
    generationTimeMs: Math.round(performance.now() - start),
    importCount: info.importCount,
    importFileCount: info.importFileCount,
  }
  const specs = buildImportQuerySpecs(app, db, allImportIds, scanner)
  return { name: 'imports', dataset, db, specs, close }
}

export function openSuite(name: SuiteName, options: SuiteOptions): Promise<Suite> {
  switch (name) {
    case 'library':
      return librarySuite(options)
    case 'imports':
      return importsSuite()
  }
}
