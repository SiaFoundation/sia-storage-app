/*
 * Builds a distributable disk image: bundle, sign, notarize and staple the
 * app, wrap it, then notarize and staple the image.
 *
 * The headless half of packaging, with nothing installed or launched, so it
 * runs on a CI runner. `bun run desktop:release <beta|prod>` is the local
 * form. The workflow in .github/workflows/release-desktop.yml runs it from a
 * `desktop/v*` GitHub release and sets RELEASE_TAG.
 *
 * The tag is the version, not package.json. A stable tag is created on the
 * release candidate's own commit, where package.json still reads X.Y.Z-rc.N,
 * so a build that read the file would ship the rc version under the stable
 * name.
 */

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { $ } from 'bun'
import { fileURLToPath } from 'node:url'
import { APP_VERSION, build, type BuildOptions, type BuildResult } from './darwin'
import { createDmg, dmgName } from './dmg'
import { type BuildEnv, readEnvValues, resolveEnv } from './env'
import { developerIdIdentity } from './identity'
import {
  assertGatekeeperAccepts,
  notarize,
  notaryKeyFrom,
  staple,
  writeNotaryKey,
} from './notarize'
import { sign } from './sign'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TAG = /^desktop\/v(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/
const RC_SUFFIX = /-rc\.\d+$/

export function versionForTag(tag: string): string {
  const match = TAG.exec(tag)
  if (!match) throw new Error(`Not a desktop release tag: ${tag}`)
  return match[1]!
}

/** A candidate is the beta app; a stable release is the shipping one. */
export function contextForTag(tag: string): 'beta' | 'prod' {
  return RC_SUFFIX.test(versionForTag(tag)) ? 'beta' : 'prod'
}

/**
 * A candidate tag must match package.json exactly. A stable tag sits on the
 * candidate's commit, so it matches package.json with the rc suffix removed.
 */
export function assertTagMatchesPackage(tag: string, packageVersion: string): void {
  const version = versionForTag(tag)
  const stable = !RC_SUFFIX.test(version)
  const ok =
    version === packageVersion || (stable && packageVersion.replace(RC_SUFFIX, '') === version)
  if (!ok) throw new Error(`${tag} does not match apps/desktop/package.json at ${packageVersion}`)
}

/**
 * Bundle, assemble, sign. electron-vite runs first because `build` copies its
 * output rather than building it.
 */
export async function buildSigned(env: BuildEnv, options?: BuildOptions): Promise<BuildResult> {
  console.log('Bundling…')
  await $`bun run build`.cwd(root)
  console.log('Assembling…')
  const result = await build(env, options)
  console.log('Signing…')
  await sign(result, env)
  return result
}

export async function release(input: {
  context?: string
  tag?: string
  buildNumber?: string
  notarize: boolean
  environment: Record<string, string | undefined>
}): Promise<string> {
  const { tag, environment } = input
  const context = tag ? contextForTag(tag) : input.context
  if (!context) throw new Error('No build context: pass one, or set RELEASE_TAG')
  if (tag && input.context && input.context !== context) {
    throw new Error(`${tag} is a ${context} release, not ${input.context}`)
  }
  const version = tag ? versionForTag(tag) : APP_VERSION
  if (tag) assertTagMatchesPackage(tag, APP_VERSION)

  // The env file or the environment may name the identity; a blank means the
  // keychain holds exactly one Developer ID certificate, which is CI's case.
  const { values, source } = readEnvValues(context, environment)
  if (!values.SIA_SIGN_IDENTITY?.trim()) {
    values.SIA_SIGN_IDENTITY = await developerIdIdentity(values.SIA_TEAM_ID?.trim())
  }
  const env = resolveEnv(values, source)
  // Read before the build, so a missing credential fails in seconds.
  const key = input.notarize ? notaryKeyFrom(environment) : undefined

  const result = await buildSigned(env, { version, buildNumber: input.buildNumber })
  const dmgPath = join(dirname(result.appPath), dmgName(env.appName, version))
  const keyDir = key ? mkdtempSync(join(environment.RUNNER_TEMP ?? tmpdir(), 'notary-')) : ''
  try {
    const keyPath = key ? writeNotaryKey(key, keyDir) : ''
    if (key) {
      // The app gets its own ticket. One stapled only to the image stays behind
      // when the app is copied out, and an offline first launch then has no
      // ticket for Gatekeeper to check.
      console.log('Notarizing the app…')
      const zip = `${result.appPath}.zip`
      await $`ditto -c -k --keepParent ${result.appPath} ${zip}`
      await notarize(zip, key, keyPath)
      rmSync(zip)
      await staple(result.appPath)
    }

    console.log('Wrapping…')
    await createDmg({
      appPath: result.appPath,
      dmgPath,
      volumeName: env.appName,
      signIdentity: env.signIdentity,
    })

    if (key) {
      console.log('Notarizing the image…')
      await notarize(dmgPath, key, keyPath)
      await staple(dmgPath)
      await assertGatekeeperAccepts(dmgPath)
    }
  } finally {
    if (keyDir) rmSync(keyDir, { recursive: true, force: true })
  }
  return dmgPath
}

if (import.meta.main) {
  const dmgPath = await release({
    context: process.argv[2] ?? process.env.SIA_CONTEXT,
    tag: process.env.RELEASE_TAG?.trim() || undefined,
    buildNumber: process.env.SIA_BUILD_NUMBER?.trim() || undefined,
    notarize: process.env.DRY_RUN !== 'true',
    environment: process.env,
  })
  console.log(`\nImage: ${dmgPath}`)
  const output = process.env.GITHUB_OUTPUT
  if (output) appendFileSync(output, `dmg=${dmgPath}\n`)
}
