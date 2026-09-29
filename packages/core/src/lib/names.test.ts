import { normalizeName, withNormalizedName } from './names'

describe('normalizeName', () => {
  it('composes a decomposed name and leaves a composed one alone', () => {
    const composed = 'café-日本.txt'
    expect(normalizeName(composed.normalize('NFD'))).toBe(composed)
    expect(normalizeName(composed)).toBe(composed)
  })
})

describe('withNormalizedName', () => {
  it('normalizes the name of a record and keeps its other fields', () => {
    const record = { id: 'a', name: 'résumé.pdf'.normalize('NFD'), size: 3 }
    expect(withNormalizedName(record)).toEqual({ id: 'a', name: 'résumé.pdf', size: 3 })
  })

  it('returns a record whose name is already composed as the same object', () => {
    const record = { id: 'a', name: 'résumé.pdf', size: 3 }
    expect(withNormalizedName(record)).toBe(record)
  })

  it('leaves a record without a name as it is', () => {
    const update = { id: 'a', size: 3 }
    expect(withNormalizedName(update)).toBe(update)
  })
})
