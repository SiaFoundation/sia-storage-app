import BackgroundTimer from 'react-native-background-timer'
import { createBackgroundDelay } from './backgroundDelay'

jest.mock('react-native-background-timer', () => ({
  __esModule: true,
  default: {
    setTimeout: jest.fn(),
    clearTimeout: jest.fn(),
  },
}))

const mockTimer = jest.mocked(BackgroundTimer)

describe('createBackgroundDelay', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves "completed" when timer fires', async () => {
    mockTimer.setTimeout.mockImplementation((cb: () => void) => {
      cb()
      return 1
    })

    const { delay } = createBackgroundDelay()

    expect(await delay(1000)).toBe('completed')
    expect(mockTimer.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      1000,
    )
  })

  it('resolves "aborted" when abort() called', async () => {
    mockTimer.setTimeout.mockImplementation(() => 42)

    const { delay, abort } = createBackgroundDelay()
    const promise = delay(10000)

    abort()

    expect(await promise).toBe('aborted')
    expect(mockTimer.clearTimeout).toHaveBeenCalledWith(42)
  })

  it('abort() is safe to call when no delay pending', () => {
    const { abort } = createBackgroundDelay()

    abort()

    expect(mockTimer.clearTimeout).not.toHaveBeenCalled()
  })

  it('multiple abort() calls only clear timer once', () => {
    mockTimer.setTimeout.mockImplementation(() => 1)

    const { delay, abort } = createBackgroundDelay()
    delay(1000)

    abort()
    abort()
    abort()

    expect(mockTimer.clearTimeout).toHaveBeenCalledTimes(1)
  })

  it('each instance has independent state', () => {
    let id = 0
    mockTimer.setTimeout.mockImplementation(() => ++id)

    const a = createBackgroundDelay()
    const b = createBackgroundDelay()

    a.delay(1000)
    b.delay(2000)

    a.abort()

    expect(mockTimer.clearTimeout).toHaveBeenCalledTimes(1)
    expect(mockTimer.clearTimeout).toHaveBeenCalledWith(1)
  })
})
