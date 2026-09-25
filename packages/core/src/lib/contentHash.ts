/*
 * A file's content hash as files.hash stores it and file metadata publishes it:
 * "sha256:" followed by the SHA-256 of the file's bytes in lowercase hex.
 *
 * Clients compare these strings as they are, to skip saving bytes a file
 * already has, to find a file by its content, and as the content version the
 * Finder item carries, so one file hashed by two code paths has to produce the
 * same string. The type admits only the prefixed form, and every hasher returns
 * one through toContentHash, so a bare digest is a type error at the call site.
 */

export type ContentHash = `sha256:${string}`

const PREFIX = 'sha256:'
const HEX_DIGEST = /^[0-9a-f]{64}$/

/** The content hash for a SHA-256 digest in hex, as node, Bun and the RN hashers return it. */
export function toContentHash(hexDigest: string): ContentHash {
  const hex = hexDigest.toLowerCase()
  if (!HEX_DIGEST.test(hex)) throw new Error(`not a SHA-256 hex digest: ${hexDigest}`)
  return `${PREFIX}${hex}`
}

/**
 * A hash read from metadata another client published. `sia add` and `sia import`
 * in the released CLI and desktop builds publish the bare hex digest, which
 * gains the prefix here so it compares equal to the same bytes hashed on this
 * device. Anything else passes through unchanged: dropping it would stop that
 * file syncing, and a value in no known form already compares unequal to every
 * hash computed here.
 */
export function parseContentHash(value: string): ContentHash | '' {
  if (value === '') return ''
  if (value.startsWith(PREFIX)) return value as ContentHash
  if (HEX_DIGEST.test(value.toLowerCase())) return `${PREFIX}${value.toLowerCase()}`
  return value as ContentHash
}
