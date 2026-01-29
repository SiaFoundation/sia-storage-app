/**
 * Node.js file system operations for tests.
 *
 * Provides the same interface as expo-file-system using Node's fs module.
 * Uses real temp directories for actual file operations.
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// Base temp directory for all tests
let baseTempDir: string | null = null

// Per-test directories
const testDirs = new Map<string, string>()

/**
 * Initialize the base temp directory
 */
export function initTempDirectory(): string {
  if (!baseTempDir) {
    baseTempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sia-test-'))
  }
  return baseTempDir
}

/**
 * Create a unique temp directory for a test
 */
export function createTestDirectory(testId: string): string {
  const base = initTempDirectory()
  const testDir = path.join(base, testId)
  fs.mkdirSync(testDir, { recursive: true })
  testDirs.set(testId, testDir)
  return testDir
}

/**
 * Get the temp directory for a test
 */
export function getTestDirectory(testId: string): string | undefined {
  return testDirs.get(testId)
}

/**
 * Clean up a test's directory
 */
export function cleanupTestDirectory(testId: string): void {
  const dir = testDirs.get(testId)
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  testDirs.delete(testId)
}

/**
 * Clean up all temp directories
 */
export function cleanupAllTempDirectories(): void {
  for (const testId of testDirs.keys()) {
    cleanupTestDirectory(testId)
  }
  if (baseTempDir && fs.existsSync(baseTempDir)) {
    fs.rmSync(baseTempDir, { recursive: true, force: true })
    baseTempDir = null
  }
}

// Helper to convert file:// URI to path
export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return uri.slice(7)
  }
  return uri
}

// Helper to convert path to file:// URI
export function pathToUri(filePath: string): string {
  if (filePath.startsWith('file://')) {
    return filePath
  }
  return `file://${filePath}`
}

/**
 * Mock expo-file-system exports
 */
export const documentDirectory = 'file://' + initTempDirectory() + '/documents/'
export const cacheDirectory = 'file://' + initTempDirectory() + '/cache/'

export async function getInfoAsync(
  uri: string,
): Promise<{ exists: boolean; size?: number; isDirectory?: boolean }> {
  try {
    const filePath = uriToPath(uri)
    const stats = fs.statSync(filePath)
    return {
      exists: true,
      size: stats.size,
      isDirectory: stats.isDirectory(),
    }
  } catch {
    return { exists: false }
  }
}

export async function readAsStringAsync(
  uri: string,
  options?: { encoding?: 'utf8' | 'base64' },
): Promise<string> {
  const filePath = uriToPath(uri)
  const encoding = options?.encoding === 'base64' ? 'base64' : 'utf8'
  return fs.readFileSync(filePath, { encoding })
}

export async function writeAsStringAsync(
  uri: string,
  content: string,
  options?: { encoding?: 'utf8' | 'base64' },
): Promise<void> {
  const filePath = uriToPath(uri)
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const encoding = options?.encoding === 'base64' ? 'base64' : 'utf8'
  fs.writeFileSync(filePath, content, { encoding })
}

export async function deleteAsync(
  uri: string,
  options?: { idempotent?: boolean },
): Promise<void> {
  try {
    const filePath = uriToPath(uri)
    fs.rmSync(filePath, { recursive: true, force: true })
  } catch (e) {
    if (!options?.idempotent) {
      throw e
    }
  }
}

export async function makeDirectoryAsync(
  uri: string,
  options?: { intermediates?: boolean },
): Promise<void> {
  const filePath = uriToPath(uri)
  fs.mkdirSync(filePath, { recursive: options?.intermediates ?? false })
}

export async function copyAsync(options: {
  from: string
  to: string
}): Promise<void> {
  const fromPath = uriToPath(options.from)
  const toPath = uriToPath(options.to)
  const toDir = path.dirname(toPath)
  fs.mkdirSync(toDir, { recursive: true })
  fs.copyFileSync(fromPath, toPath)
}

export async function moveAsync(options: {
  from: string
  to: string
}): Promise<void> {
  const fromPath = uriToPath(options.from)
  const toPath = uriToPath(options.to)
  const toDir = path.dirname(toPath)
  fs.mkdirSync(toDir, { recursive: true })
  fs.renameSync(fromPath, toPath)
}

export async function readDirectoryAsync(uri: string): Promise<string[]> {
  const filePath = uriToPath(uri)
  return fs.readdirSync(filePath)
}

/**
 * File class that matches expo-file-system's File
 */
export class File {
  private _uri: string

  constructor(parentOrUri: string | Directory, name?: string) {
    if (name && parentOrUri instanceof Directory) {
      this._uri = path.join(parentOrUri.uri, name)
    } else {
      this._uri = parentOrUri as string
    }
  }

  get uri(): string {
    return this._uri
  }

  info(): { exists: boolean; size?: number } {
    try {
      const filePath = uriToPath(this._uri)
      const stats = fs.statSync(filePath)
      return { exists: true, size: stats.size }
    } catch {
      return { exists: false }
    }
  }

  async text(): Promise<string> {
    return readAsStringAsync(this._uri)
  }

  async bytes(): Promise<Uint8Array> {
    const filePath = uriToPath(this._uri)
    return new Uint8Array(fs.readFileSync(filePath))
  }

  copy(destination: File): void {
    const fromPath = uriToPath(this._uri)
    const toPath = uriToPath(destination.uri)
    const toDir = path.dirname(toPath)
    fs.mkdirSync(toDir, { recursive: true })
    fs.copyFileSync(fromPath, toPath)
  }

  delete(): void {
    const filePath = uriToPath(this._uri)
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath)
    }
  }
}

/**
 * Directory class that matches expo-file-system's Directory
 */
export class Directory {
  private _uri: string

  constructor(parentOrUri: string | Directory, name?: string) {
    if (name && typeof parentOrUri === 'string') {
      this._uri = path.join(parentOrUri, name)
    } else if (name && parentOrUri instanceof Directory) {
      this._uri = path.join(parentOrUri.uri, name)
    } else {
      this._uri = parentOrUri as string
    }
  }

  get uri(): string {
    return this._uri
  }

  info(): { exists: boolean; isDirectory: boolean } {
    try {
      const dirPath = uriToPath(this._uri)
      const stats = fs.statSync(dirPath)
      return { exists: true, isDirectory: stats.isDirectory() }
    } catch {
      return { exists: false, isDirectory: false }
    }
  }

  create(options?: { intermediates?: boolean }): void {
    const dirPath = uriToPath(this._uri)
    fs.mkdirSync(dirPath, { recursive: options?.intermediates ?? false })
  }

  list(): File[] {
    const dirPath = uriToPath(this._uri)
    try {
      const entries = fs.readdirSync(dirPath)
      return entries.map((name) => new File(this, name))
    } catch {
      return []
    }
  }
}

/**
 * Paths object that matches expo-file-system's Paths
 */
export const Paths = {
  get document(): string {
    return initTempDirectory() + '/documents'
  },
  get cache(): string {
    return initTempDirectory() + '/cache'
  },
}

/**
 * Calculate content hash using Node's crypto (same as react-native-quick-crypto)
 */
export function calculateHash(data: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Create a test file with random content
 */
export function createTestFile(
  testDir: string,
  name: string,
  sizeBytes: number,
): { uri: string; hash: string; size: number } {
  const content = crypto.randomBytes(sizeBytes)
  const filePath = path.join(testDir, name)
  fs.writeFileSync(filePath, content)
  const hash = calculateHash(content)
  return {
    uri: pathToUri(filePath),
    hash,
    size: sizeBytes,
  }
}

/**
 * Copy a test asset to the test directory
 */
export function copyTestAsset(
  assetPath: string,
  testDir: string,
  name?: string,
): { uri: string; hash: string; size: number } {
  const content = fs.readFileSync(assetPath)
  const fileName = name ?? path.basename(assetPath)
  const destPath = path.join(testDir, fileName)
  fs.writeFileSync(destPath, content)
  const hash = calculateHash(content)
  return {
    uri: pathToUri(destPath),
    hash,
    size: content.length,
  }
}
