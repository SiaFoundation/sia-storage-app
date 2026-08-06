/*
 * Assembles Sia Storage.app around the stock Electron bundle.
 *
 * Three payloads: the electron-vite bundles, the daemon as a Bun runtime plus a
 * script, and the extension as an .appex under Contents/PlugIns, which must be
 * in place before the outer signature seals it. Laid out here rather than by
 * electron-builder, which embeds a provisioning profile only for Mac App Store
 * targets. Each non-obvious step carries the symptom it prevents.
 */

import { $ } from 'bun'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, type BuildEnv } from './env'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
// Apple Silicon only, as is the daemon's native addon below. An Intel build
// would need both, and there is no consumer asking for one.
const TARGET = 'arm64-apple-macos13.0'
/** Also the executable name inside the helper bundle, and what Electron spawns. */
const AGENT_NAME = 'SiaDomainAgent'
// The version the extension presents in its handshake. Read from the CLI so the
// app and the daemon it talks to can never disagree about which build they are.
const VERSION = (await Bun.file(join(repoRoot, 'apps', 'cli', 'package.json')).json())
  .version as string

export type BuildResult = {
  appPath: string
  appexPath: string
  agentPath: string
  resourcesPath: string
  frameworksPath: string
}

export async function build(env: BuildEnv): Promise<BuildResult> {
  const out = join(root, 'dist')
  const appPath = join(out, `${env.appName}.app`)
  rmSync(appPath, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  const electron = join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app')
  if (!existsSync(electron)) {
    throw new Error(`No Electron at ${electron}. Run bun run desktop:setup.`)
  }
  cpSync(electron, appPath, { recursive: true, verbatimSymlinks: true })

  const contents = join(appPath, 'Contents')
  const resources = join(contents, 'Resources')
  const frameworks = join(contents, 'Frameworks')
  const appexContents = join(contents, 'PlugIns', 'SiaFileProvider.appex', 'Contents')
  mkdirSync(join(appexContents, 'MacOS'), { recursive: true })

  const executable = env.appName.replace(/\s+/g, '')
  await $`mv ${join(contents, 'MacOS', 'Electron')} ${join(contents, 'MacOS', executable)}`

  const agentPath = join(contents, 'Helpers', `${AGENT_NAME}.app`)
  const agentContents = join(agentPath, 'Contents')
  mkdirSync(join(agentContents, 'MacOS'), { recursive: true })

  const swiftBuild = join(out, 'swift-build')
  await installApp(resources, env)
  await buildDaemon(resources)
  await compileShared(swiftBuild)
  await compileExtension(join(appexContents, 'MacOS', 'SiaFileProvider'), swiftBuild)
  await compileAgent(join(agentContents, 'MacOS', AGENT_NAME))
  writeFileSync(join(agentContents, 'Info.plist'), agentInfoPlist(env))

  writeFileSync(join(contents, 'Info.plist'), appInfoPlist(env, executable))
  writeFileSync(join(appexContents, 'Info.plist'), extensionInfoPlist(env))
  // Apple's own File Provider bundles carry this, and its absence correlates
  // with PluginKit declining to register the extension.
  writeFileSync(join(appexContents, 'PkgInfo'), 'XPC!')
  mkdirSync(join(appexContents, 'Resources'), { recursive: true })

  return {
    appPath,
    appexPath: join(contents, 'PlugIns', 'SiaFileProvider.appex'),
    agentPath,
    resourcesPath: resources,
    frameworksPath: frameworks,
  }
}

/**
 * Places the electron-vite output where Electron looks for an app.
 *
 * The stock bundle ships default_app.asar, the window that offers to open a
 * folder. Electron prefers it over Resources/app, so leaving it in place gives a
 * signed bundle that launches into the wrong program.
 */
async function installApp(resources: string, env: BuildEnv): Promise<void> {
  const built = join(root, 'out')
  if (!existsSync(built)) throw new Error(`No build at ${built}. Run bun run desktop:build.`)

  rmSync(join(resources, 'default_app.asar'), { force: true })
  const app = join(resources, 'app')
  cpSync(built, join(app, 'out'), { recursive: true })
  cpSync(join(root, 'assets'), join(app, 'assets'), { recursive: true })
  // The name keys Electron's user-data directory and single-instance lock,
  // so a shared one would make the side-by-side contexts collide: the second
  // to launch would exit as a duplicate instance of the first.
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify({ name: env.appBundleId, version: VERSION, main: 'out/main/index.js' }, null, 2)}\n`,
  )
  // Written rather than hardcoded: the container and the mount both follow the
  // bundle id this build was signed with.
  writeFileSync(
    join(app, 'config.json'),
    `${JSON.stringify(
      {
        domainId: env.domainId,
        displayName: env.domainDisplay,
        extensionBundleId: env.extBundleId,
      },
      null,
      2,
    )}\n`,
  )
}

/**
 * Ships the daemon as the Bun runtime plus a script, not a compiled binary.
 *
 * `bun build --compile` appends the JavaScript and native addons after the
 * Mach-O, and codesign leaves Bun unable to find that payload: every SDK call
 * fails with "Native addon not found". A runtime plus a script has no appended
 * payload to lose, the addon is an ordinary file, and signing the runtime is
 * signing a stock executable.
 */
async function buildDaemon(resources: string): Promise<void> {
  const entry = join(repoRoot, 'apps', 'cli', 'src', 'index.ts')
  // One directory, not --outfile: the CLI pulls in assets Bun emits alongside
  // the script, and --outfile accepts a single output.
  await $`bun build ${entry} --target=bun --bundle --outdir ${resources} --entry-naming daemon.js`.cwd(
    repoRoot,
  )

  // Whichever bun is first on PATH is the one that ships, so two builds of one
  // commit can carry different runtimes.
  const bun = (await $`which bun`.text()).trim()
  await $`cp ${bun} ${join(resources, 'bun')}`

  const addon = '@siafoundation/sia-storage-darwin-arm64'
  const destination = join(resources, 'node_modules', addon)
  mkdirSync(dirname(destination), { recursive: true })
  await $`cp -R ${join(repoRoot, 'node_modules', addon)} ${destination}`
}

/**
 * Compiles the shared transport layer into a real module first.
 *
 * The extension does `import SiaShared`, and swiftc only resolves that against a
 * compiled module: handing every source to one invocation instead would put them
 * all in a single anonymous module and the import would not resolve. SwiftPM
 * builds the same sources as a module for the tests, so this keeps the two build
 * paths agreeing on the shape.
 */
async function compileShared(buildDir: string): Promise<void> {
  mkdirSync(buildDir, { recursive: true })
  const sources = swiftSources('Shared')
  await $`swiftc -O -parse-as-library -emit-module -emit-library -static -module-name SiaShared -emit-module-path ${join(buildDir, 'SiaShared.swiftmodule')} -o ${join(buildDir, 'libSiaShared.a')} ${sources} -target ${TARGET}`
}

/**
 * Compiles the extension.
 *
 * It has no main. The Mach-O entry is NSExtensionMain, which reads
 * NSExtensionPrincipalClass from Info.plist and serves fileproviderd. A normal
 * main keeps the process alive without connecting, so fileproviderd respawns it
 * forever, and calling NSExtensionMain from inside main is too late.
 *
 * swiftc rather than SwiftPM, which has no way to emit an .appex.
 */
async function compileExtension(destination: string, buildDir: string): Promise<void> {
  const sources = swiftSources('Ext')
  await $`swiftc -O -parse-as-library -o ${destination} ${sources} -I ${buildDir} -L ${buildDir} -lSiaShared -framework FileProvider -Xlinker -e -Xlinker _NSExtensionMain -target ${TARGET}`
}

function swiftSources(dir: string): string[] {
  const cwd = join(root, 'native', 'macos', dir)
  return [...new Bun.Glob('*.swift').scanSync({ cwd, absolute: true })]
}

/**
 * Compiles the program that registers the Finder mount.
 *
 * A bundle rather than a bare executable in `Contents/MacOS`, because the call
 * it makes is entitled and an entitlement is carried by a provisioning profile,
 * which only a bundle can embed.
 */
async function compileAgent(destination: string): Promise<void> {
  const sources = swiftSources('Agent')
  await $`swiftc -O -o ${destination} ${sources} -framework FileProvider -target ${TARGET}`
}

function agentInfoPlist(env: BuildEnv): string {
  return plist({
    CFBundleIdentifier: `${env.appBundleId}.domain-agent`,
    CFBundleName: AGENT_NAME,
    CFBundleExecutable: AGENT_NAME,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: VERSION,
    CFBundleVersion: '1',
    // Spawned with argv and never shown, so it must not take focus from the app
    // that spawned it.
    LSBackgroundOnly: true,
    LSMinimumSystemVersion: '13.0',
  })
}

function appInfoPlist(env: BuildEnv, executable: string): string {
  return plist({
    CFBundleIdentifier: env.appBundleId,
    CFBundleName: env.appName,
    CFBundleExecutable: executable,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: VERSION,
    CFBundleVersion: '1',
    // The app is its menu bar item; a dock tile would be noise.
    LSUIElement: true,
    // Electron's NSApplication subclass, named in its stock Info.plist. This
    // plist replaces that one, so the class has to come along.
    NSPrincipalClass: 'AtomApplication',
    LSMinimumSystemVersion: '13.0',
  })
}

function extensionInfoPlist(env: BuildEnv): string {
  return plist({
    CFBundleIdentifier: env.extBundleId,
    CFBundleName: 'SiaFileProvider',
    CFBundleExecutable: 'SiaFileProvider',
    CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: VERSION,
    CFBundleVersion: '1',
    NSExtension: {
      NSExtensionPointIdentifier: 'com.apple.fileprovider-nonui',
      // Matches the @objc name on the class. fileproviderd resolves it through
      // NSClassFromString, which cannot find a Swift-mangled symbol.
      NSExtensionPrincipalClass: 'FileProviderExtension',
      NSExtensionFileProviderSupportsEnumeration: true,
      // Without a document group fileproviderd logs "Extension doesn't have a
      // group container... Ignoring the extension" and never loads it.
      NSExtensionFileProviderDocumentGroup: env.fileProviderGroup,
    },
  })
}

export function plist(value: Record<string, unknown>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${toPlistValue(value, '')}
</plist>
`
}

function toPlistValue(value: unknown, indent: string): string {
  if (typeof value === 'boolean') return `${indent}<${value}/>`
  if (typeof value === 'string') return `${indent}<string>${escapeXml(value)}</string>`
  if (Array.isArray(value)) {
    const items = value.map((v) => toPlistValue(v, `${indent}  `)).join('\n')
    return `${indent}<array>\n${items}\n${indent}</array>`
  }
  if (typeof value !== 'object' || value === null) {
    // A number or null would fall through to Object.entries and serialise as
    // an empty <dict/>, surfacing as a broken bundle far from the bad value.
    throw new Error(`plist cannot represent ${value === null ? 'null' : typeof value}`)
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${indent}  <key>${escapeXml(k)}</key>\n${toPlistValue(v, `${indent}  `)}`)
    .join('\n')
  return `${indent}<dict>\n${entries}\n${indent}</dict>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

if (import.meta.main) {
  const result = await build(loadEnv())
  console.log(result.appPath)
}
