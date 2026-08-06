/*
 * Signs the bundle, inside out, and checks the traps rather than trusting them.
 *
 * codesign seals a directory's contents, so anything signed after its container
 * breaks that seal: dylibs, helpers, frameworks and the daemon runtime first,
 * then the agent and extension, then the app. A versioned framework seals at
 * Versions/A, and the outer path leaves symlinks `--deep --strict` rejects.
 * Nothing notarizes, so a build runs only on a Mac its profile names.
 */

import { $, Glob } from 'bun'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { plist, type BuildResult } from './darwin'
import type { BuildEnv } from './env'

/**
 * Entitlements that must never ship.
 *
 * Either one makes amfi SIGKILL the app at launch under a development
 * certificate, exit 137, with no message beyond "the application can't be
 * opened". The provisioning profile may authorize them; the signed entitlements
 * must not request them.
 */
const FORBIDDEN_ENTITLEMENTS = [
  'com.apple.developer.fileprovider.testing-mode',
  'com.apple.developer.team-identifier',
]

export function appEntitlements(env: BuildEnv): string {
  return plist({
    'com.apple.application-identifier': `${env.teamId}.${env.appBundleId}`,
    'com.apple.security.application-groups': [env.fileProviderGroup],
    'com.apple.security.network.client': true,
    'com.apple.security.files.user-selected.read-write': true,
    // Bun compiles at runtime, so without these the JIT allocation fails and the
    // daemon dies at once. Electron's V8 needs the same.
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.cs.allow-unsigned-executable-memory': true,
    // The SDK addon is signed by this team, but the Electron framework loads
    // dylibs Apple built, and library validation rejects the mix.
    'com.apple.security.cs.disable-library-validation': true,
  })
}

/** Electron's helper processes run V8 too, and inherit nothing from the app. */
export function helperEntitlements(): string {
  return plist({
    'com.apple.security.cs.allow-jit': true,
    'com.apple.security.cs.allow-unsigned-executable-memory': true,
    'com.apple.security.cs.disable-library-validation': true,
    'com.apple.security.cs.allow-dyld-environment-variables': true,
  })
}

export function extensionEntitlements(env: BuildEnv): string {
  return plist({
    'com.apple.application-identifier': `${env.teamId}.${env.extBundleId}`,
    // Required of a File Provider extension by the system, and the reason it
    // cannot write anywhere but its own container.
    'com.apple.security.app-sandbox': true,
    // The group container fileproviderd insists on before loading an extension.
    // Not a channel: a sandboxed extension can read one and not write it.
    'com.apple.security.application-groups': [env.fileProviderGroup],
    'com.apple.security.network.client': true,
  })
}

/** Fails on a forbidden entitlement before anything is signed with it. */
export function assertNoForbiddenEntitlements(plistText: string, label: string): void {
  for (const key of FORBIDDEN_ENTITLEMENTS) {
    if (plistText.includes(key)) {
      throw new Error(`${label} requests ${key}, which makes amfi kill the app at launch`)
    }
  }
}

export async function sign(build: BuildResult, env: BuildEnv): Promise<void> {
  const appEnt = appEntitlements(env)
  const extEnt = extensionEntitlements(env)
  const helperEnt = helperEntitlements()
  assertNoForbiddenEntitlements(appEnt, 'the app entitlements')
  assertNoForbiddenEntitlements(extEnt, 'the extension entitlements')
  // The helper set signs `bun` and Electron's own helper apps, so a forbidden
  // key there is as fatal as one in the app's, and amfi says as little about it.
  assertNoForbiddenEntitlements(helperEnt, 'the helper entitlements')

  const beside = (name: string) => join(build.appPath, '..', name)
  const appEntPath = beside('app.entitlements')
  const extEntPath = beside('ext.entitlements')
  const helperEntPath = beside('helper.entitlements')
  writeFileSync(appEntPath, appEnt)
  writeFileSync(extEntPath, extEnt)
  writeFileSync(helperEntPath, helperEnt)

  copyFileSync(env.appProfile, join(build.appPath, 'Contents', 'embedded.provisionprofile'))
  copyFileSync(env.extProfile, join(build.appexPath, 'Contents', 'embedded.provisionprofile'))
  // The agent's own copy of the app's profile. It makes the entitled call with
  // the app's identity, and a nested bundle is the only place a profile fits.
  copyFileSync(env.appProfile, join(build.agentPath, 'Contents', 'embedded.provisionprofile'))

  // Xcode tags downloaded profiles with com.apple.quarantine, and codesign
  // refuses to seal a bundle carrying it.
  await $`xattr -cr ${build.appPath}`.nothrow()

  const seal = (target: string, entitlements?: string, identifier?: string) =>
    $`codesign --force --timestamp --options runtime --sign ${env.signIdentity} ${
      entitlements ? ['--entitlements', entitlements] : []
    } ${identifier ? ['--identifier', identifier] : []} ${target}`

  for (const dylib of find(build.frameworksPath, '**/*.dylib')) await seal(dylib)
  for (const helper of find(build.frameworksPath, '*.app')) await seal(helper, helperEntPath)
  for (const framework of find(build.frameworksPath, '*.framework')) {
    const versioned = join(framework, 'Versions', 'A')
    await seal(existsSync(versioned) ? versioned : framework)
  }

  // Same identity as the runtime: a hardened process only dlopens its own team's
  // libraries, and the SDK reports that as "Native addon not found".
  for (const addon of find(build.resourcesPath, '**/*.node')) await seal(addon)
  await seal(join(build.resourcesPath, 'bun'), helperEntPath, env.appBundleId)

  await seal(build.agentPath, appEntPath, env.appBundleId)
  await seal(build.appexPath, extEntPath, env.extBundleId)
  await seal(build.appPath, appEntPath, env.appBundleId)

  await $`codesign --verify --deep --strict ${build.appPath}`
  await verifySealedEntitlements(build.appPath, 'the signed app')
  await verifySealedEntitlements(build.appexPath, 'the signed extension')
  // The agent carries the app's entitlements, which is what makes the entitled
  // mount call possible, so what sealed into it matters as much as the other two.
  await verifySealedEntitlements(build.agentPath, 'the signed domain agent')
}

function find(root: string, pattern: string): string[] {
  if (!existsSync(root)) return []
  return [...new Glob(pattern).scanSync({ cwd: root, absolute: true, onlyFiles: false })]
}

/** Re-reads what actually got sealed, rather than trusting what was passed in. */
async function verifySealedEntitlements(bundle: string, label: string): Promise<void> {
  const sealed = await $`codesign -d --entitlements :- ${bundle}`.nothrow().text()
  // A failed read returns nothing, and nothing satisfies every check below it,
  // so the absence has to be the error rather than a silent pass.
  if (!sealed.includes('<plist')) {
    throw new Error(`Could not read the entitlements sealed into ${label}`)
  }
  assertNoForbiddenEntitlements(sealed, label)
}
