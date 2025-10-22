type KeysWithNullish<T> = {
  [K in keyof T]-?: null extends T[K] ? K : undefined extends T[K] ? K : never
}[keyof T]

type KeysWithoutNullish<T> = Exclude<keyof T, KeysWithNullish<T>>

type Cleaned<T> = {
  [K in KeysWithoutNullish<T>]: T[K]
} & {
  [K in KeysWithNullish<T>]?: Exclude<T[K], null | undefined>
}

/**
 * Removes all null and undefined values from an object.
 * @param obj - The object to clean.
 * @returns The cleaned object.
 */
export function removeEmptyValues<T extends Record<string, unknown>>(
  obj: T
): Cleaned<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([_, value]) => value !== null && value !== undefined
    )
  ) as Cleaned<T>
}
