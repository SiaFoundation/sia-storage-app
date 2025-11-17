import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const projectRoot = path.resolve(__dirname, '..')

const task = process.argv[2]
if (!task) {
  console.error(
    'Missing Gradle task argument (e.g. signingReport or bundleRelease).'
  )
  process.exit(1)
}

const androidDir = path.join(projectRoot, 'android')
const requiredEnvKeys = [
  'SIA_RELEASE_STORE_FILE',
  'SIA_RELEASE_STORE_PASSWORD',
  'SIA_RELEASE_KEY_ALIAS',
  'SIA_RELEASE_KEY_PASSWORD',
]

const missing = requiredEnvKeys.filter((key) => !process.env[key])
if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(
      ', '
    )}. Ensure they are defined in your .env file or shell.`
  )
  process.exit(1)
}

const envOverrides: Record<string, string> = {}

const storeFile = process.env.SIA_RELEASE_STORE_FILE
if (storeFile) {
  const resolvedStoreFile = path.isAbsolute(storeFile)
    ? storeFile
    : path.resolve(projectRoot, storeFile)

  if (!fs.existsSync(resolvedStoreFile)) {
    console.error(`Release keystore not found at ${resolvedStoreFile}.`)
    process.exit(1)
  }

  envOverrides.SIA_RELEASE_STORE_FILE = resolvedStoreFile
}

const finalEnv = { ...process.env, ...envOverrides }

const result = spawnSync('./gradlew', [task], {
  cwd: androidDir,
  stdio: 'inherit',
  env: finalEnv,
})

if (result.error) {
  console.error(result.error)
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
