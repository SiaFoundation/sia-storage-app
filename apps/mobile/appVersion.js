// Store-facing version identifiers, derived from the package.json version.
//
// Apple rejects non-numeric marketing versions, so a release candidate X.Y.Z-rc.N
// ships as marketing version X.Y.Z and is told apart by its build id. iOS
// buildNumber and Android versionCode share one encoding,
// M * 1000000 + m * 10000 + p * 100 + n (n = rc number, 99 for final), which
// orders rc.0 < ... < final < the next version's rc.0 and outranks the retired
// M * 10000 + m * 100 + p scheme (last shipped 1.13.4 = 11304). Both stores
// reject a reused build id, so the strict increase is required.
// CommonJS because app.config.js loads it during expo prebuild.

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/

/**
 * @param {string} version the raw package.json version, `X.Y.Z` or `X.Y.Z-rc.N`
 * @returns {{ marketingVersion: string, versionCode: number, buildNumber: string }}
 */
function deriveAppVersion(version) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) {
    throw new Error(`unsupported app version "${version}": expected X.Y.Z or X.Y.Z-rc.N`)
  }
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number)
  const rc = match[4] === undefined ? null : Number(match[4])
  if (minor > 99 || patch > 99 || (rc !== null && rc > 98)) {
    throw new Error(
      `app version "${version}" overflows the versionCode encoding (minor/patch <= 99, rc <= 98)`,
    )
  }
  const versionCode = major * 1000000 + minor * 10000 + patch * 100 + (rc ?? 99)
  return {
    marketingVersion: `${major}.${minor}.${patch}`,
    versionCode,
    buildNumber: String(versionCode),
  }
}

module.exports = { deriveAppVersion }
