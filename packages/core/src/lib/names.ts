/**
 * The one form every file, folder and tag name is stored and looked up in:
 * Unicode NFC. One visible name reaches the core composed (é as a single code
 * point, as phones and most apps give it) or decomposed (e and a combining
 * accent, as macOS file systems and the Finder folder hand it back). Stored as
 * given, those are two names to the library, and matching by name, such as
 * grouping a file's versions, misses.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFC')
}

/**
 * `record` with its name, when it has one, in the stored form. A record whose
 * name is already in that form comes back as the same object, uncopied.
 */
export function withNormalizedName<T extends object>(record: T): T {
  if (!('name' in record) || typeof record.name !== 'string') return record
  const name = normalizeName(record.name)
  return name === record.name ? record : { ...record, name }
}
