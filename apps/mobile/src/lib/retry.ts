import { logger } from '@siastorage/logger'

/**
 * Generic helper to retry an async operation with delay on failure
 * @param name - Name of the operation for logging purposes
 * @param operation - Function to execute
 * @param maxAttempts - Maximum number of attempts (default: 5)
 * @param delayMs - Delay for first retry in milliseconds (default: 500)
 * @returns Promise with the operation result
 */
const MAX_BACKOFF_MS = 30000
const JITTER_RATIO = 0.2

export async function retry<T>(
  name: string,
  operation: () => Promise<T>,
  maxAttempts = 5,
  delayMs = 500,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      // Log the retry attempt.
      const exponentialDelay = Math.min(
        delayMs * 2 ** (attempt - 1),
        MAX_BACKOFF_MS,
      )
      // Jitter spreads out retries occurring at the same time a little bit.
      const jitterOffset =
        exponentialDelay * JITTER_RATIO * (Math.random() * 2 - 1)
      const delayWithJitter = Math.max(
        0,
        Math.round(exponentialDelay + jitterOffset),
      )
      logger.warn('retry', 'attempt_failed', {
        name,
        attempt,
        maxAttempts,
        delayMs: delayWithJitter,
        error: error instanceof Error ? error : new Error(String(error)),
      })

      // If this was the last attempt, do not delay, just throw.
      if (attempt === maxAttempts) {
        // Enhance error message with attempt information.
        if (error instanceof Error) {
          error.message = `Failed after ${maxAttempts} attempts: ${error.message}`
        }
        throw error
      }

      // Wait before next attempt.
      await new Promise((resolve) => setTimeout(resolve, delayWithJitter))
    }
  }

  // This should never be reached due to the throw in the loop, but TypeScript needs it.
  throw new Error(`Failed after ${maxAttempts} attempts`)
}
