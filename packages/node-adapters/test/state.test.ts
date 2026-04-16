import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { DaemonState } from '../src/state'
import { readState, removeState, writeState } from '../src/state'

let tempDir: string
let statePath: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-state-test-'))
  statePath = path.join(tempDir, 'state.json')
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('state', () => {
  it('writeState then readState round-trips correctly', () => {
    const state: DaemonState = {
      pid: 12345,
      startedAt: Date.now(),
      connected: true,
    }
    writeState(statePath, state)
    const read = readState(statePath)
    expect(read).toEqual(state)
  })

  it('readState returns null for missing file', () => {
    expect(readState(statePath)).toBeNull()
  })

  it('readState returns null for corrupt JSON', () => {
    fs.writeFileSync(statePath, 'not json{{{')
    expect(readState(statePath)).toBeNull()
  })

  it('removeState deletes the file', () => {
    writeState(statePath, { pid: 1, startedAt: 0, connected: false })
    removeState(statePath)
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('removeState does not throw for missing file', () => {
    expect(() => removeState(statePath)).not.toThrow()
  })

  it('state includes all fields', () => {
    const state: DaemonState = {
      pid: 1,
      startedAt: 1000,
      connected: false,
    }
    writeState(statePath, state)
    const read = readState(statePath)
    expect(read).toHaveProperty('pid', 1)
    expect(read).toHaveProperty('startedAt', 1000)
    expect(read).toHaveProperty('connected', false)
  })
})
