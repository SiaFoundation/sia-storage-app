/**
 * App Core Test Harness
 *
 * Controls app lifecycle for core tests with:
 * - Full initialization like the real app
 * - Real temp directories for file operations
 * - Pause/resume for assertions mid-flow
 * - Wait helpers for async operations
 * - Mock SDK access for event injection
 */

import * as crypto from 'crypto'
import * as nodefs from 'fs'
import * as path from 'path'
import { closeDb, initializeDB, resetDb } from '../../src/db'
import { sqlInsert } from '../../src/db/sql'
import {
  areServiceIntervalsPaused,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
  shutdownAllServiceIntervals,
} from '../../src/lib/serviceInterval'
import {
  initSyncDownEvents,
  resetSyncDownCursor,
} from '../../src/managers/syncDownEvents'
import { initSyncUpMetadata } from '../../src/managers/syncUpMetadata'
import { initThumbnailScanner } from '../../src/managers/thumbnailScanner'
import { getUploadManager } from '../../src/managers/uploader'
import { initUploadScanner } from '../../src/managers/uploadScanner'
import { setAppKeyForIndexer } from '../../src/stores/appKey'
import {
  createFileRecord,
  type FileRecord,
  getFilesLocalOnly,
  readAllFileRecords,
} from '../../src/stores/files'
import {
  ensureFsStorageDirectory,
  fsStorageDirectory,
} from '../../src/stores/fs'
import {
  setIsConnected,
  setSdk,
  setSdkWithUploader,
} from '../../src/stores/sdk'
import { getIndexerURL } from '../../src/stores/settings'
import { readThumbnailsByHash } from '../../src/stores/thumbnails'
import {
  getActiveUploads,
  getUploadCounts,
  getUploadState,
  type UploadStatus,
  useUploadsStore,
} from '../../src/stores/uploads'
import { MockSdk } from './mockSdk'
import { cleanupTestDirectory } from './nodeFileSystem'
import { waitForCondition, waitForCount } from './waitFor'

export interface AppCoreHarness {
  /** Full initialization like the real app */
  start(): Promise<void>

  /** Clean shutdown of all services */
  shutdown(): Promise<void>

  /** Pause all service intervals for assertions */
  pause(): void

  /** Resume all service intervals */
  resume(): void

  /** Direct SDK access for injection */
  sdk: MockSdk

  /** Temp directory for this harness */
  tempDir: string

  /** Wait for file count to reach a specific number */
  waitForFileCount(count: number, timeout?: number): Promise<void>

  /** Wait for thumbnails to be generated for specific files */
  waitForThumbnails(fileIds: string[], timeout?: number): Promise<void>

  /** Wait for all uploads to complete */
  waitForUploadsComplete(timeout?: number): Promise<void>

  /** Wait for a custom condition */
  waitForCondition(
    fn: () => boolean | Promise<boolean>,
    timeout?: number,
  ): Promise<void>

  /** Get all file records */
  getFiles(): Promise<FileRecord[]>

  /** Get active upload count */
  getActiveUploadCount(): number

  /** Track service errors (for connectivity tests) */
  getServiceErrors(serviceName: string): Error[]

  /** Wait for upload status to reach a specific state */
  waitForUploadStatus(
    fileId: string,
    status: UploadStatus | 'removed',
    timeout?: number,
  ): Promise<void>

  /** Wait for all active uploads to complete */
  waitForNoActiveUploads(timeout?: number): Promise<void>

  /** Wait for upload count */
  waitForUploadCount(count: number, timeout?: number): Promise<void>

  /** Check if services are running (not paused) */
  areServicesRunning(): boolean
}

interface HarnessOptions {
  /** Skip SDK connection (for testing offline scenarios) */
  skipSdkConnection?: boolean

  /** Custom indexer URL */
  indexerURL?: string
}

let testCounter = 0
let fileIdCounter = 0

class AppCoreHarnessImpl implements AppCoreHarness {
  sdk: MockSdk
  private serviceErrors: Map<string, Error[]> = new Map()
  private started = false
  private options: HarnessOptions
  private testId: string

  constructor(options: HarnessOptions = {}) {
    this.sdk = new MockSdk()
    this.options = options
    // Generate unique test ID for isolation
    testCounter++
    this.testId = `test-${testCounter}-${Date.now()}`
  }

  // Get the temp directory from the fs store (created by nodeFileSystem mock)
  get tempDir(): string {
    return fsStorageDirectory.uri
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Harness already started. Call shutdown() first.')
    }

    // Reset state
    this.serviceErrors.clear()
    this.sdk.reset()
    useUploadsStore.setState({ uploads: {} })

    // Initialize database with unique name for test isolation
    await initializeDB({ databaseName: `${this.testId}.db` })

    // Ensure the fs storage directory exists
    ensureFsStorageDirectory()

    // Set up SDK and initialize uploader
    if (!this.options.skipSdkConnection) {
      // Set up app key for the test indexer first
      const indexerURL = await getIndexerURL()
      await setAppKeyForIndexer(indexerURL, this.sdk.appKey())
      await setSdkWithUploader(
        this.sdk as unknown as Parameters<typeof setSdkWithUploader>[0],
      )
      setIsConnected(true)
    }

    // Initialize services
    initUploadScanner()
    initSyncDownEvents()
    initSyncUpMetadata()
    initThumbnailScanner()

    this.started = true
  }

  async shutdown(): Promise<void> {
    if (!this.started) return

    // Stop all services
    shutdownAllServiceIntervals()

    // Allow pending async operations to complete before clearing state
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Clear SDK state
    setSdk(null)
    setIsConnected(false)

    // Reset and close database for proper cleanup
    await resetDb()
    await closeDb()
    await resetSyncDownCursor()

    // Clear uploads store and reset upload manager
    useUploadsStore.setState({ uploads: {} })
    getUploadManager().reset()

    // Reset SDK
    this.sdk.reset()

    // Clean up temp directory for this test
    cleanupTestDirectory(this.testId)

    this.started = false
  }

  pause(): void {
    pauseAllServiceIntervals()
  }

  resume(): void {
    resumeAllServiceIntervals()
  }

  async waitForFileCount(count: number, timeout = 10_000): Promise<void> {
    await waitForCount(() => this.getFiles(), count, {
      timeout,
      message: 'File count',
    })
  }

  async waitForThumbnails(fileIds: string[], timeout = 10_000): Promise<void> {
    await waitForCondition(
      async () => {
        const files = await this.getFiles()
        const targetFiles = files.filter((f) => fileIds.includes(f.id))

        for (const file of targetFiles) {
          if (!file.hash) continue
          const thumbnails = await readThumbnailsByHash(file.hash)
          if (thumbnails.length === 0) return false
        }

        return true
      },
      { timeout, message: 'Thumbnails' },
    )
  }

  async waitForUploadsComplete(timeout = 30_000): Promise<void> {
    await waitForCondition(
      () => {
        const active = getActiveUploads()
        return active.length === 0
      },
      { timeout, message: 'Uploads complete' },
    )
  }

  async waitForCondition(
    fn: () => boolean | Promise<boolean>,
    timeout = 10_000,
  ): Promise<void> {
    await waitForCondition(fn, { timeout })
  }

  async getFiles(): Promise<FileRecord[]> {
    return readAllFileRecords({ order: 'ASC' })
  }

  getActiveUploadCount(): number {
    return getActiveUploads().length
  }

  getServiceErrors(serviceName: string): Error[] {
    return this.serviceErrors.get(serviceName) ?? []
  }

  async waitForUploadStatus(
    fileId: string,
    status: UploadStatus | 'removed',
    timeout = 30_000,
  ): Promise<void> {
    await waitForCondition(
      () => {
        const state = getUploadState(fileId)
        if (status === 'removed') return state === undefined
        return state?.status === status
      },
      { timeout, message: `Upload ${fileId} to reach ${status}` },
    )
  }

  async waitForNoActiveUploads(timeout = 30_000): Promise<void> {
    // Wait for:
    // 1. No active uploads in progress
    // 2. No pending local-only files waiting to be picked up by scanner
    await waitForCondition(
      async () => {
        const activeUploads = getActiveUploads()
        if (activeUploads.length > 0) return false

        // Also check there are no pending files waiting to be uploaded
        const pendingFiles = await getFilesLocalOnly({ limit: 1, order: 'ASC' })
        return pendingFiles.length === 0
      },
      { timeout, message: 'No active uploads and no pending files' },
    )
  }

  async waitForUploadCount(count: number, timeout = 30_000): Promise<void> {
    await waitForCondition(
      () => {
        return getUploadCounts().total === count
      },
      { timeout, message: `Upload count to be ${count}` },
    )
  }

  areServicesRunning(): boolean {
    return !areServiceIntervalsPaused()
  }
}

/**
 * Create a new test harness instance.
 */
export function createHarness(options?: HarnessOptions): AppCoreHarness {
  return new AppCoreHarnessImpl(options)
}

/**
 * Test file with real file system backing
 */
export interface TestFileInput {
  id: string
  name: string
  type: string
  size: number
  hash: string
  uri: string
}

/**
 * Generate test files with random content in the fs storage directory.
 * These are real files that can be read by the upload system.
 * Files are placed where getFsFileUri expects them: fsStorageDirectory/${id}.${ext}
 */
export function generateTestFiles(
  count: number,
  options: {
    startId?: number
    /** File type: 'data' (default) skips thumbnailing, 'image'/'video' triggers it */
    type?: 'data' | 'image' | 'video' | 'mixed'
    sizeBytes?: number
  } = {},
): ((harness: AppCoreHarness) => TestFileInput)[] {
  const { startId = 1, type = 'data', sizeBytes } = options

  return Array.from({ length: count }, (_, i) => {
    const id = startId + i
    const isVideo = type === 'video' || (type === 'mixed' && i % 3 === 0)
    const isImage = type === 'image' || (type === 'mixed' && i % 3 !== 0)

    let ext: string
    let mimeType: string
    if (isVideo) {
      ext = '.mp4'
      mimeType = 'video/mp4'
    } else if (isImage) {
      ext = '.jpg'
      mimeType = 'image/jpeg'
    } else {
      // 'data' type - won't trigger thumbnail generation
      ext = '.bin'
      mimeType = 'application/octet-stream'
    }

    const size = sizeBytes ?? 1024 * (id + 1)
    const fileId = `test-file-${id}`

    // Return a factory function that creates the file in the fs storage dir
    return (harness: AppCoreHarness): TestFileInput => {
      // Create file with the exact naming convention getFsFileForId expects
      const filePath = path.join(harness.tempDir, `${fileId}${ext}`)

      // Create real file with random content
      const content = crypto.randomBytes(size)
      nodefs.writeFileSync(filePath, content)

      // Calculate real hash
      const hash = crypto.createHash('sha256').update(content).digest('hex')

      return {
        id: fileId,
        name: `file-${id}${ext}`,
        type: mimeType,
        size,
        hash,
        uri: `file://${filePath}`,
      }
    }
  })
}

/**
 * Generate test files using real test images (for thumbnail testing).
 */
export function generateTestFilesFromAssets(
  assetDir: string,
  fileNames: string[],
): ((harness: AppCoreHarness) => TestFileInput)[] {
  return fileNames.map((fileName) => {
    return (harness: AppCoreHarness): TestFileInput => {
      // Increment counter when factory is called to ensure unique IDs across tests
      fileIdCounter++
      const fileId = `test-file-${fileIdCounter}`
      const srcPath = path.join(assetDir, fileName)

      // Determine type from extension
      const ext = path.extname(fileName).toLowerCase()
      const mimeType =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : 'application/octet-stream'

      // Copy to fs storage dir with the naming convention getFsFileForId expects
      const destPath = path.join(harness.tempDir, `${fileId}${ext}`)
      const content = nodefs.readFileSync(srcPath)
      nodefs.writeFileSync(destPath, content)

      // Calculate real hash
      const hash = crypto.createHash('sha256').update(content).digest('hex')

      return {
        id: fileId,
        name: fileName,
        type: mimeType,
        size: content.length,
        hash,
        uri: `file://${destPath}`,
      }
    }
  })
}

/**
 * Helper to add files to the database and mark them as local.
 * Creates file records and fs entries so the scanner can find them.
 */
export async function addTestFilesToHarness(
  harness: AppCoreHarness,
  fileFactories: ((harness: AppCoreHarness) => TestFileInput)[],
): Promise<TestFileInput[]> {
  const now = Date.now()
  const files: TestFileInput[] = []

  for (const factory of fileFactories) {
    const file = factory(harness)
    files.push(file)

    await createFileRecord({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      hash: file.hash,
      createdAt: now,
      updatedAt: now,
      localId: null,
      addedAt: now,
    })

    // Add fs metadata entry so the file is detected as "local"
    await sqlInsert('fs', {
      fileId: file.id,
      size: file.size,
      addedAt: now,
      usedAt: now,
    })
  }

  return files
}

/**
 * Helper to simulate onboarding with the mock SDK.
 */
export async function simulateOnboarding(
  harness: AppCoreHarness,
  _mnemonic: string = 'test mnemonic phrase',
): Promise<void> {
  // In a real scenario, this would derive keys from the mnemonic.
  // For testing, we just ensure the SDK is connected.
  setSdk(harness.sdk as unknown as Parameters<typeof setSdk>[0])
  setIsConnected(true)
}

/**
 * Helper to wait for sync to pick up injected events.
 */
export async function waitForSyncComplete(
  harness: AppCoreHarness,
  expectedCount: number,
  timeout = 15_000,
): Promise<void> {
  await harness.waitForFileCount(expectedCount, timeout)
}
