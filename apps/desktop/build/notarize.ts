/*
 * Submits a zipped app or a disk image to Apple's notary service and staples
 * the ticket to it.
 *
 * Gatekeeper opens a downloaded app only when Apple has scanned it, so
 * without this step every Mac but the build machine refuses it.
 */

import { $ } from 'bun'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type NotaryKey = {
  keyId: string
  issuerId: string
  /** The `.p8` file's text. */
  pem: string
}

/**
 * Reads APPLE_API_KEY (the key id), APPLE_API_ISSUER and APPLE_KEY_B64 (the
 * `.p8` file, base64) and names whichever is missing or malformed.
 */
export function notaryKeyFrom(environment: Record<string, string | undefined>): NotaryKey {
  const read = (name: string): string => {
    const value = environment[name]?.trim()
    if (!value) throw new Error(`${name} is not set`)
    return value
  }
  const keyId = read('APPLE_API_KEY')
  const issuerId = read('APPLE_API_ISSUER')
  const pem = Buffer.from(read('APPLE_KEY_B64'), 'base64').toString('utf8').trim()
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('APPLE_KEY_B64 does not decode to a PEM private key')
  }
  return { keyId, issuerId, pem }
}

/** Writes the key where notarytool can read it and returns the path. */
export function writeNotaryKey(key: NotaryKey, dir: string): string {
  const path = join(dir, `AuthKey_${key.keyId}.p8`)
  writeFileSync(path, `${key.pem}\n`, { mode: 0o600 })
  return path
}

export async function notarize(path: string, key: NotaryKey, keyPath: string): Promise<void> {
  const auth = ['--key', keyPath, '--key-id', key.keyId, '--issuer', key.issuerId]
  // No verdict means the upload was dropped or timed out, so it is resent.
  // A verdict, accepted or rejected, is final.
  let submitted = ''
  let failure = ''
  let verdict: { id?: string; status?: string } = {}
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result =
      await $`xcrun notarytool submit ${path} ${auth} --wait --timeout 30m --output-format json`.nothrow()
    submitted = result.stdout.toString()
    // The verdict comes back on stdout, but a rejected credential or a bad
    // argument goes to stderr, leaving stdout empty.
    failure = result.stderr.toString()
    verdict = parseSubmission(submitted)
    if (verdict.status) break
    console.log(`notarytool returned no verdict (attempt ${attempt} of 3)`)
  }
  const { id, status } = verdict
  if (status === 'Accepted') return
  // The status alone says nothing about which file failed which check; the log
  // lists each issue with its path, and only the log tells you what to change.
  const log = id ? await $`xcrun notarytool log ${id} ${auth}`.nothrow().text() : ''
  const detail = log.trim() || failure.trim() || submitted.trim()
  throw new Error(`Notarization ${status ?? 'did not complete'}: ${detail}`)
}

export function parseSubmission(output: string): { id?: string; status?: string } {
  // --wait prints one JSON object per state change; the last carries the verdict.
  const objects = output
    .split(/\n(?=\{)/)
    .map((chunk) => {
      try {
        return JSON.parse(chunk) as { id?: string; status?: string }
      } catch {
        return undefined
      }
    })
    .filter((o) => o !== undefined)
  return objects.at(-1) ?? {}
}

export async function staple(path: string): Promise<void> {
  // The ticket can take a minute to reach the server stapler queries after
  // the verdict, and stapler reports that as "could not find ticket".
  for (let attempt = 1; ; attempt++) {
    const result = await $`xcrun stapler staple ${path}`.nothrow()
    if (result.exitCode === 0) break
    // stapler writes its failures to stdout and leaves stderr empty.
    if (attempt === 5) throw new Error(`stapler failed: ${result.stdout.toString().trim()}`)
    await Bun.sleep(15_000)
  }
  await $`xcrun stapler validate ${path}`
}

/** What Gatekeeper decides for the image, run as the user opening it would. */
export async function assertGatekeeperAccepts(dmgPath: string): Promise<void> {
  const result =
    await $`spctl -a -t open --context context:primary-signature -v ${dmgPath}`.nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Gatekeeper rejects ${dmgPath}: ${result.stderr.toString().trim()}`)
  }
}
