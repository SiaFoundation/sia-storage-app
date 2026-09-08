import { describe, expect, it } from 'bun:test'
import {
  emptySlots,
  fillFrom,
  isComplete,
  normalizeWord,
  splitPhrase,
  suggestions,
  wordStatus,
} from './phrase'

const PHRASE = 'verb sense save like guard steel pause where glimpse gasp annual input'.split(' ')

describe('splitPhrase', () => {
  it('reads a numbered list as twelve words', () => {
    const numbered = PHRASE.map((word, i) => `${i + 1}. ${word}`).join('\n')
    expect(splitPhrase(numbered)).toEqual(PHRASE)
  })

  it('reads a comma separated phrase as words', () => {
    expect(splitPhrase('Verb, Sense,  Save')).toEqual(['verb', 'sense', 'save'])
  })
})

describe('fillFrom', () => {
  it('writes forward from the slot that was pasted into', () => {
    expect(fillFrom(emptySlots(), 10, ['annual', 'input'])).toEqual([
      ...Array.from({ length: 10 }, () => ''),
      'annual',
      'input',
    ])
  })

  it('drops words that would run past the last slot', () => {
    expect(fillFrom(emptySlots(), 11, ['input', 'extra'])).toEqual([
      ...Array.from({ length: 11 }, () => ''),
      'input',
    ])
  })
})

describe('wordStatus', () => {
  it('leaves a half-typed word unmarked while it is being typed', () => {
    expect(wordStatus('gua', true)).toBe('partial')
  })

  it('marks a half-typed word wrong once focus leaves it', () => {
    expect(wordStatus('gua', false)).toBe('unknown')
  })

  it('marks a word that is not in the list wrong as it is typed', () => {
    expect(wordStatus('guarb', true)).toBe('unknown')
  })

  it('accepts a word in the list', () => {
    expect(wordStatus('guard', false)).toBe('known')
  })
})

describe('suggestions', () => {
  it('offers the list entries a prefix could still become', () => {
    expect(suggestions('gui')).toEqual(['guide', 'guilt', 'guitar'])
  })

  it('offers nothing for an empty slot', () => {
    expect(suggestions('')).toEqual([])
  })

  it('caps a prefix that most of the list matches', () => {
    expect(suggestions('a').length).toBe(5)
  })
})

describe('isComplete', () => {
  it('is true only once all twelve slots hold a real word', () => {
    expect(isComplete(PHRASE)).toBe(true)
    expect(isComplete(fillFrom(PHRASE, 0, ['zzz']))).toBe(false)
    expect(isComplete(PHRASE.slice(0, 11))).toBe(false)
  })
})

describe('normalizeWord', () => {
  it('drops the case and punctuation a paste can carry in', () => {
    expect(normalizeWord('Guard,')).toBe('guard')
  })
})
