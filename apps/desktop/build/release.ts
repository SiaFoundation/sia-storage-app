/*
 * Builds what a release attaches for one app: bundle, sign, notarize and
 * staple the app, zip it for the updater, wrap it in a disk image, then
 * notarize and staple the image.
 *
 * The headless half of packaging, with nothing installed or launched, so it
 * runs on a CI runner. `bun run desktop:release <beta|prod>` is the local
 * form. The workflow in .github/workflows/release-desktop.yml runs it once
 * for each app a `desktop/v*` tag builds, with RELEASE_TAG and SIA_CONTEXT set.
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
import { APP_VERSION, build, releaseFileName, type BuildOptions, type BuildResult } from './darwin'
import { createDmg } from './dmg'
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

/**
 * The apps a tag builds. `release` builds the first when it is given no
 * context. A candidate is the beta app. A stable release is the shipping app
 * and the beta app too, because beta installs update from every desktop
 * release and an install only accepts an update signed under its own bundle
 * id. Without a beta build of the stable version, a beta install would wait
 * for the next candidate.
 */
export function contextsForTag(tag: string): Array<'beta' | 'prod'> {
  return RC_SUFFIX.test(versionForTag(tag)) ? ['beta'] : ['prod', 'beta']
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
}): Promise<{ dmgPath: string; zipPath: string }> {
  const { tag, environment } = input
  const context = input.context ?? (tag ? contextsForTag(tag)[0] : undefined)
  if (!context) throw new Error('No build context: pass one, or set RELEASE_TAG')
  if (tag && !(contextsForTag(tag) as string[]).includes(context)) {
    throw new Error(`${tag} builds ${contextsForTag(tag).join(' and ')}, not ${context}`)
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
  const dmgPath = join(dirname(result.appPath), releaseFileName(env.appName, version, 'dmg'))
  const zipPath = join(dirname(result.appPath), releaseFileName(env.appName, version, 'zip'))
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

    // After stapling, so an install updated from the zip carries its ticket
    // the same as one copied from the image and launches offline.
    console.log('Zipping for updates…')
    rmSync(zipPath, { force: true })
    await $`ditto -c -k --sequesterRsrc --keepParent ${result.appPath} ${zipPath}`

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
  return { dmgPath, zipPath }
}

if (import.meta.main) {
  const { dmgPath, zipPath } = await release({
    context: process.argv[2] ?? (process.env.SIA_CONTEXT?.trim() || undefined),
    tag: process.env.RELEASE_TAG?.trim() || undefined,
    buildNumber: process.env.SIA_BUILD_NUMBER?.trim() || undefined,
    notarize: process.env.DRY_RUN !== 'true',
    environment: process.env,
  })
  console.log(`\nImage: ${dmgPath}\nUpdate: ${zipPath}`)
  const output = process.env.GITHUB_OUTPUT
  if (output) appendFileSync(output, `dmg=${dmgPath}\nzip=${zipPath}\n`)
}
