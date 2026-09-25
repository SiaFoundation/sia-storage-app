import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ingestFile } from '../../src/lib/ingestFile'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cli-ingest-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

it('stores the hash in the sha256: form every other client stores', async () => {
  const app = await createTestApp(tempDir)
  const source = path.join(tempDir, 'note.txt')
  fs.writeFileSync(source, 'hello')

  const { id } = await ingestFile(app, { filePath: source })

  const file = await app.service.files.getById(id)
  expect(file?.hash).toBe(`sha256:${createHash('sha256').update('hello').digest('hex')}`)
  app.db.close?.()
})
