export type MaybeError<T> = [T, null] | [null, Error]

/**
 * Define a list of keys for a record type, enforcing that all keys are present.
 * @example
 * const keys = keysOf<FileMetadata>()(['id', 'name', 'type', 'kind', 'size', 'hash', 'createdAt', 'updatedAt', 'thumbForId', 'thumbSize'])
 */
export function keysOf<T>() {
  return <K extends readonly (keyof T)[]>(keys: K & Record<Exclude<keyof T, K[number]>, never>) =>
    keys
}
