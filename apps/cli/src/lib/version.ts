import pkg from '../../package.json'

// A released binary is built from the commit its tag points at, and for a
// graduated release that commit's package.json still reads X.Y.Z-rc.N, so
// release-cli.yml substitutes the tag's version here at build time. A build-time
// constant rather than an env var: the version of a shipped binary is a fact
// about the build, not something a caller should be able to change. `typeof`
// guards the identifier not existing at all in a build that omits the define.
declare const SIA_CLI_VERSION: string | undefined

/** The version this binary was released as, or package.json's in a source build. */
export function cliVersion(): string {
  return typeof SIA_CLI_VERSION === 'string' ? SIA_CLI_VERSION : pkg.version
}
