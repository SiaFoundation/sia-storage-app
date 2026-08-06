/*
 * Build, sign, install, launch, and hand back what to look for.
 *
 * The renderer and main bundles come from electron-vite, which runs first
 * because the assembled bundle copies its output rather than building it.
 *
 * `bun run desktop:package <context>` is the whole of it. The development loop
 * in `dev.ts` runs the same steps and then swaps the renderer for a dev server,
 * which is why this is a function rather than a script body.
 */

import { $ } from 'bun'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from './darwin'
import { type BuildEnv, loadEnv } from './env'
import { install, isExtensionRegistered, launch, linkCli } from './install'
import { sign } from './sign'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function packageApp(
  env: BuildEnv,
  /** What the launched app gets on top of a normal launch context. */
  launchEnv: Record<string, string> = {},
): Promise<string> {
  console.log('Bundling…')
  await $`bun run build`.cwd(root)

  console.log('Assembling…')
  const result = await build(env)

  console.log('Signing…')
  await sign(result, env)

  console.log('Installing…')
  const installed = await install(result.appPath)
  const cli = linkCli(installed)
  await launch(installed, launchEnv)

  // PluginKit registration is asynchronous after launch, and the app spends
  // its daemon-attach retries before registering, so this polls rather than
  // report a failure that has not happened yet.
  let registered = false
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; await Bun.sleep(500)) {
    registered = await isExtensionRegistered(env.extBundleId)
    if (registered) break
  }

  console.log(`\nInstalled: ${installed}`)
  console.log(
    cli.occupied
      ? `CLI: ${cli.path} exists and is not this app's shim; left in place`
      : cli.effective
        ? `CLI: ${cli.path}`
        : cli.shadowedBy
          ? `CLI: ${cli.path} (not the \`sia\` you get: ${cli.shadowedBy} comes first on PATH)`
          : `CLI: ${cli.path} (add ${dirname(cli.path)} to PATH to run it as \`sia\`)`,
  )
  console.log(
    registered
      ? `Extension registered. Look for "${env.domainDisplay}" in the Finder sidebar.`
      : 'Extension not registered yet. Check Console.app for fileproviderd, and confirm the profiles cover this Mac.',
  )

  return installed
}

if (import.meta.main) {
  // `bun run desktop:package prod` reads env/prod.env.
  await packageApp(loadEnv(process.argv[2] ?? process.env.SIA_CONTEXT ?? 'dev'))
}
