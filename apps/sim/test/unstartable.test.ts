import { describe, expect, test } from 'bun:test'
import { type StartOutcome, unstartable } from '../src/unstartable'

const ok = (...needs: StartOutcome['needs']): StartOutcome => ({ needs })
const failed = (kind: 'ios' | 'android', reason: string): StartOutcome => ({
  needs: [kind],
  failed: { kind, reason },
})

describe('unstartable', () => {
  test('two failed starts of a kind in a row stop that kind, with the first reason', () => {
    const stuck = unstartable([failed('android', 'first'), failed('android', 'second')])
    expect([...stuck]).toEqual([['android', 'first']])
  })

  test('one failed start stops nothing', () => {
    expect(unstartable([ok('android'), failed('android', 'first')]).size).toBe(0)
  })

  test('a start that succeeded between two failures keeps the kind running', () => {
    const outcomes = [failed('android', 'a'), ok('android'), failed('android', 'b')]
    expect(unstartable(outcomes).size).toBe(0)
  })

  test('a scenario without phones between two failures does not break the streak', () => {
    const outcomes = [failed('ios', 'a'), ok(), failed('ios', 'b')]
    expect(unstartable(outcomes).get('ios')).toBe('a')
  })

  test('a success after two failures, from a scenario already running, starts the kind again', () => {
    const outcomes = [failed('ios', 'a'), failed('ios', 'b'), ok('ios')]
    expect(unstartable(outcomes).size).toBe(0)
  })

  test('failures of two different kinds stop neither', () => {
    expect(unstartable([failed('ios', 'a'), failed('android', 'b')]).size).toBe(0)
  })

  test('the other kind keeps running when one kind is stopped', () => {
    const outcomes = [failed('android', 'a'), ok('ios'), failed('android', 'b')]
    const stuck = unstartable(outcomes)
    expect(stuck.has('android')).toBe(true)
    expect(stuck.has('ios')).toBe(false)
  })

  test("a scenario that ended on another kind's failed start is passed over for this kind", () => {
    const iosFailedFirst: StartOutcome = {
      needs: ['ios', 'android'],
      failed: { kind: 'ios', reason: 'x' },
    }
    const outcomes = [failed('android', 'a'), iosFailedFirst, failed('android', 'b')]
    expect(unstartable(outcomes).get('android')).toBe('a')
  })
})
