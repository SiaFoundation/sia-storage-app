import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { instrumentDatabase } from '../instrument'
import { diffStructure, profileSpecs, type SpecStructure } from './structure'

function structure(reads: number, writes: number, execs = 0): SpecStructure {
  return { reads, writes, execs, result: 'rows: 1', plans: [] }
}

describe('diffStructure', () => {
  test('a read swapped for a write is reported though the total is unchanged', () => {
    const changes = diffStructure(
      'library',
      { specs: { move: structure(2, 1) } },
      { specs: { move: structure(1, 2) } },
    )
    assert.equal(changes.length, 1)
    assert.equal(changes[0].what, 'statements')
    assert.equal(changes[0].direction, 'changed')
  })

  test('an added statement is reported as worse', () => {
    const changes = diffStructure(
      'library',
      { specs: { move: structure(2, 1) } },
      { specs: { move: structure(2, 2) } },
    )
    assert.equal(changes[0].direction, 'worse')
  })
})

describe('profileSpecs', () => {
  test('a spec that throws does not stop the specs after it from running', async () => {
    const db = instrumentDatabase(createBetterSqlite3Database())
    await db.execAsync('CREATE TABLE t (n INTEGER)')
    let laterRuns = 0
    const { specs, errors } = await profileSpecs(db, [
      {
        name: 'throws',
        category: 'test',
        run: async () => {
          throw new Error('no such index')
        },
      },
      {
        name: 'inserts',
        category: 'test',
        run: async () => {
          laterRuns++
          return db.runAsync('INSERT INTO t (n) VALUES (1)')
        },
      },
    ])
    assert.deepEqual(errors, { throws: 'no such index' })
    assert.equal(specs.inserts.writes, 1)
    assert.equal(laterRuns, 2)
  })
})
