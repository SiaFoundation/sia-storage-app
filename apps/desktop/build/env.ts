/*
 * Reads the signing and identity settings for a build context.
 *
 * Three layers, later ones winning: the committed `<context>.example.env`
 * carries the identity (bundle ids, names) and blanks for the five values
 * that are one machine's or one team's secrets; a gitignored `<context>.env`
 * fills those in on a developer Mac; and `SIA_*` variables in the environment
 * fill them in on a CI runner, which has no env file to write.
 *
 * Every value is required. A missing one is reported by name rather than left to
 * surface later as a codesign or fileproviderd failure that names nothing.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const envDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'env')

export type BuildEnv = {
  teamId: string
  signIdentity: string
  appBundleId: string
  extBundleId: string
  fileProviderGroup: string
  appProfile: string
  extProfile: string
  domainId: string
  domainDisplay: string
  appName: string
  /** A file in apps/desktop/assets/icons. */
  appIcon: string
}

const FIELDS: Array<[keyof BuildEnv, string]> = [
  ['teamId', 'SIA_TEAM_ID'],
  ['signIdentity', 'SIA_SIGN_IDENTITY'],
  ['appBundleId', 'SIA_APP_BUNDLE_ID'],
  ['extBundleId', 'SIA_EXT_BUNDLE_ID'],
  ['fileProviderGroup', 'SIA_FILEPROVIDER_GROUP'],
  ['appProfile', 'SIA_APP_PROFILE'],
  ['extProfile', 'SIA_EXT_PROFILE'],
  ['domainId', 'SIA_DOMAIN_ID'],
  ['domainDisplay', 'SIA_DOMAIN_DISPLAY'],
  ['appName', 'SIA_APP_NAME'],
  ['appIcon', 'SIA_APP_ICON'],
]

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
  }
  return out
}

export function resolveEnv(values: Record<string, string>, source: string): BuildEnv {
  const missing = FIELDS.filter(([, key]) => !values[key]?.trim()).map(([, key]) => key)
  if (missing.length > 0) {
    throw new Error(`${source} is missing: ${missing.join(', ')}`)
  }
  const out = {} as BuildEnv
  for (const [field, key] of FIELDS) out[field] = values[key]!.trim()
  for (const [field, key] of [
    ['appProfile', 'SIA_APP_PROFILE'],
    ['extProfile', 'SIA_EXT_PROFILE'],
  ] as const) {
    if (!existsSync(out[field])) throw new Error(`${key} names no file: ${out[field]}`)
  }
  return out
}

/** The `SIA_*` settings present and non-blank in an environment. */
export function envOverrides(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, key] of FIELDS) {
    const value = environment[key]
    if (value?.trim()) out[key] = value
  }
  return out
}

/** The merged settings before validation, and where to say they came from. */
export function readEnvValues(
  context: string,
  environment: Record<string, string | undefined>,
): { values: Record<string, string>; source: string } {
  const example = join(envDir, `${context}.example.env`)
  if (!existsSync(example)) throw new Error(`No such build context: ${context}`)
  const file = join(envDir, `${context}.env`)
  const local = existsSync(file)
  const overrides = envOverrides(environment)
  if (!local && Object.keys(overrides).length === 0) {
    throw new Error(
      `No ${context}.env in apps/desktop/env. Copy ${context}.example.env and fill in the five blanks.`,
    )
  }
  return {
    values: {
      ...parseEnv(readFileSync(example, 'utf8')),
      ...(local ? parseEnv(readFileSync(file, 'utf8')) : {}),
      ...overrides,
    },
    source: local ? file : `${example} plus the SIA_* environment`,
  }
}

export function loadEnv(
  context = process.env.SIA_CONTEXT ?? 'dev',
  environment: Record<string, string | undefined> = process.env,
): BuildEnv {
  const { values, source } = readEnvValues(context, environment)
  return resolveEnv(values, source)
}
