/**
 * Result type for operations that can succeed or fail.
 */

/** Tuple-based result for simple success/error cases. */
export type Result<T, E = Error> = [T, null] | [null, E]

/** Helper to create success result. */
export function ok<T>(value: T): [T, null] {
  return [value, null]
}

/** Helper to create error result. */
export function err<E = Error>(error: E): [null, E] {
  return [null, error]
}

/** Type guard to check if result is success. */
export function isOk<T, E>(result: Result<T, E>): result is [T, null] {
  return result[1] === null
}

/** Type guard to check if result is error. */
export function isErr<T, E>(result: Result<T, E>): result is [null, E] {
  return result[1] !== null
}

/** Unwrap a result, throwing if it's an error. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isErr(result)) {
    throw result[1]
  }
  return result[0]
}

/** Unwrap a result with a default value. */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isErr(result)) {
    return defaultValue
  }
  return result[0]
}

/** Wrap an async function in try-catch and return a Result. */
export async function tryCatch<T>(
  fn: () => Promise<T>,
): Promise<Result<T, Error>> {
  try {
    return ok(await fn())
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}
