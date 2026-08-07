import { mutate } from 'swr'
import { swrCacheBy } from './swr'

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
  mutate: jest.fn(() => Promise.resolve()),
}))

const mockMutate = mutate as jest.MockedFunction<typeof mutate>

describe('swrCacheBy', () => {
  beforeEach(() => {
    mockMutate.mockClear()
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  describe('coalesced', () => {
    it('invalidates at once, then once per window for the rest of a burst', () => {
      const cache = swrCacheBy()
      const d = cache.coalesced(1000)
      d.invalidate('all')
      d.invalidate('all')
      d.invalidate('all')
      expect(mockMutate).toHaveBeenCalledTimes(1)
      jest.advanceTimersByTime(1000)
      expect(mockMutate).toHaveBeenCalledTimes(2)
      jest.advanceTimersByTime(1000)
      expect(mockMutate).toHaveBeenCalledTimes(2)
    })

    it('flush invalidates the key even when no prior trigger exists', () => {
      const cache = swrCacheBy()
      const d = cache.coalesced(1000)
      d.flush('all')
      expect(mockMutate).toHaveBeenCalledTimes(1)
      const key = mockMutate.mock.calls[0][0] as string[]
      expect(Array.isArray(key)).toBe(true)
      expect(key[0].endsWith('/all')).toBe(true)
    })

    it('flush invalidates all when called without parts and no prior trigger', () => {
      const cache = swrCacheBy()
      const d = cache.coalesced(1000)
      d.flush()
      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(typeof mockMutate.mock.calls[0][0]).toBe('function')
    })

    it('flush fires a marked invalidation now and nothing fires later', () => {
      const cache = swrCacheBy()
      const d = cache.coalesced(1000)
      d.invalidate('all')
      d.invalidate('all')
      expect(mockMutate).toHaveBeenCalledTimes(1)
      d.flush('all')
      expect(mockMutate).toHaveBeenCalledTimes(2)
      jest.advanceTimersByTime(1000)
      expect(mockMutate).toHaveBeenCalledTimes(2)
    })
  })
})
