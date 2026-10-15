/*
 * Ordering the release versions this repository tags: `X.Y.Z` and
 * `X.Y.Z-rc.N`, the only two shapes knope cuts for the app and the CLI. A
 * candidate sorts below the stable release of the same number, so a beta
 * build on `1.2.0-rc.3` moves to `1.2.0` once it ships.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/

/** Null for anything that is not one of the two shapes. */
export function parseVersion(version: string): number[] | null {
  const match = VERSION.exec(version)
  if (!match) return null
  const [, major, minor, patch, rc] = match
  return [
    Number(major),
    Number(minor),
    Number(patch),
    rc === undefined ? Number.POSITIVE_INFINITY : Number(rc),
  ]
}

/** Negative when `a` is older, positive when newer. Throws on a version neither shape matches. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) throw new Error(`Cannot compare ${a} with ${b}`)
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1
  }
  return 0
}

export function isCandidate(version: string): boolean {
  return /-rc\.\d+$/.test(version)
}
