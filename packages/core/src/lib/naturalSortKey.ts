export function naturalSortKey(name: string | null): string | null {
  if (name == null) return null
  return name.toLowerCase().replace(/\d+/g, (m) => m.padStart(20, '0'))
}
