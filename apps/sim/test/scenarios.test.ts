import { expect, test } from 'bun:test'
import { findScenarios } from '../src/run'

// defineScenario validates a scenario's bug marks when its file is imported, so
// without this a bad mark surfaces only when someone runs that scenario.
test('every scenario file loads and passes defineScenario', async () => {
  const files = await findScenarios([])
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    expect(typeof (await import(file)).default.name).toBe('string')
  }
})
