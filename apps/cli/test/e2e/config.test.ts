jest.setTimeout(60_000)
import { createE2eContext } from './helpers'

let ctx: ReturnType<typeof createE2eContext>

beforeEach(async () => {
  ctx = createE2eContext()
  await ctx.sia('connect')
})

afterEach(() => {
  ctx.cleanup()
})

describe('config', () => {
  it('shows indexer URL', async () => {
    const r = await ctx.sia('config')
    expect(r.stdout).toContain('Indexer URL')
    expect(r.stdout).toContain('https://sia.storage')
  })

  it('sets and reads config value', async () => {
    await ctx.sia('config', 'set', 'indexerUrl', 'https://custom.indexer')
    const r = await ctx.sia('config')
    expect(r.stdout).toContain('https://custom.indexer')
  })
})
