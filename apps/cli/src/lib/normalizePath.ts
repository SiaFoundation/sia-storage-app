/** Strip leading and trailing slashes from a path. */
export function normalizePath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '')
}
