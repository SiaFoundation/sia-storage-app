export class TimeoutError extends Error {
  constructor(message = 'Connection timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

/** Wraps a promise with a timeout. Rejects with TimeoutError if not resolved in time. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
