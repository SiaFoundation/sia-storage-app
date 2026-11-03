/*
 * Build, sign, install, launch, and hand back what to look for.
 *
 * `bun run desktop:package <context>` is the whole of it. The development loop
 * in `dev.ts` runs the same steps and then swaps the renderer for a dev server,
 * which is why this is a function rather than a script body. The bundling and
 * signing half is `buildSigned` in `release.ts`, which CI runs without an install.
 */

import { dirname } from 'node:path'
import { withDesktopInstall } from '@siastorage/sim/desktop-lock'
import { type BuildEnv, loadEnv } from './env'
import { install, isExtensionRegistered, launch, linkCli } from './install'
import { buildSigned } from './release'

export async function packageApp(
  /** The build context `env` was read for, such as `test`. */
  context: string,
  env: BuildEnv,
  /** What the launched app gets on top of a normal launch context. */
  launchEnv: Record<string, string> = {},
): Promise<string> {
  const result = await buildSigned(env)

  // Installing quits the app and replaces it, so it waits until no sim
  // session in another checkout, and no sim run, is driving this build, and
  // holds it until the new app is up so none starts on it halfway.
  const { installed, cli, registered } = await withDesktopInstall(
    context,
    env.appName,
    async () => {
      console.log('Installing…')
      const installed = await install(result.appPath)
      const cli = env.linkCli ? linkCli(installed) : null
      await launch(installed, launchEnv)

      // PluginKit registration is asynchronous after launch, and the app spends
      // its daemon-attach retries before registering, so this polls rather than
      // report a failure that has not happened yet.
      let registered = false
      for (const deadline = Date.now() + 15_000; Date.now() < deadline; await Bun.sleep(500)) {
        registered = await isExtensionRegistered(env.extBundleId)
        if (registered) break
      }
      return { installed, cli, registered }
    },
  )

  console.log(`\nInstalled: ${installed}`)
  console.log(
    !cli
      ? 'CLI: not linked for this build'
      : cli.occupied
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
  const context = process.argv[2] ?? process.env.SIA_CONTEXT ?? 'dev'
  await packageApp(context, loadEnv(context))
}
