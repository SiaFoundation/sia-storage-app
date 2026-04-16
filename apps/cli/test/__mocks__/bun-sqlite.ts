export class Database {
  constructor(_path: string) {
    throw new Error('bun:sqlite is not available in test environment. Use createTestApp() instead.')
  }
}
