import { describe, expect, it } from 'bun:test'
import { dmgName } from './dmg'
import { developerIdIdentityFrom } from './identity'
import { notaryKeyFrom, parseSubmission } from './notarize'
import { assertTagMatchesPackage, contextForTag, versionForTag } from './release'

describe('the disk image name', () => {
  it.each([
    ['Sia Storage Beta', '1.2.0-rc.0', 'Sia-Storage-Beta-1.2.0-rc.0-arm64.dmg'],
    ['Sia Storage', '1.2.0', 'Sia-Storage-1.2.0-arm64.dmg'],
  ])('%s at %s is %s', (appName, version, expected) => {
    expect(dmgName(appName, version)).toBe(expected)
  })
})

describe('the Developer ID identity', () => {
  const developerId = 'A'.repeat(40)
  const listing = `Policy: Code Signing
  Matching identities
  1) ${'B'.repeat(40)} "Apple Development: Someone (ABC123)"
  2) ${developerId} "Developer ID Application: The Sia Foundation Inc (TEAM123)"
     2 identities found

  Valid identities only
  1) ${'B'.repeat(40)} "Apple Development: Someone (ABC123)"
  2) ${developerId} "Developer ID Application: The Sia Foundation Inc (TEAM123)"
     2 valid identities found
`

  it('picks the Developer ID Application entry over a development one', () => {
    expect(developerIdIdentityFrom(listing)).toBe(developerId)
    expect(developerIdIdentityFrom(listing, 'TEAM123')).toBe(developerId)
  })

  it('names what it found when no entry is for the team', () => {
    expect(() => developerIdIdentityFrom(listing, 'OTHER')).toThrow(
      /for team OTHER.*Apple Development: Someone/,
    )
  })

  it('refuses to guess between two Developer ID entries', () => {
    const two = `1) ${'C'.repeat(40)} "Developer ID Application: One (T1)"\n2) ${'D'.repeat(40)} "Developer ID Application: Two (T2)"\n`
    expect(() => developerIdIdentityFrom(two)).toThrow(/More than one/)
    expect(developerIdIdentityFrom(two, 'T2')).toBe('D'.repeat(40))
  })
})

describe('the notary key', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
  const environment = {
    APPLE_API_KEY: 'K',
    APPLE_API_ISSUER: 'I',
    APPLE_KEY_B64: Buffer.from(`${pem}\n`).toString('base64'),
  }

  it('decodes the base64 .p8 back to its text', () => {
    expect(notaryKeyFrom(environment)).toEqual({ keyId: 'K', issuerId: 'I', pem })
  })

  it.each(['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_KEY_B64'])(
    'names %s when it is unset',
    (name) => {
      expect(() => notaryKeyFrom({ ...environment, [name]: ' ' })).toThrow(`${name} is not set`)
    },
  )

  it('rejects a value that is not a PEM key', () => {
    expect(() =>
      notaryKeyFrom({ ...environment, APPLE_KEY_B64: Buffer.from('hello').toString('base64') }),
    ).toThrow(/does not decode to a PEM/)
  })
})

describe('the notarytool verdict', () => {
  it('reads the last object notarytool --wait prints', () => {
    const output =
      '{"id":"1","status":"In Progress"}\n{"id":"1","status":"Invalid","message":"x"}\n'
    expect(parseSubmission(output)).toMatchObject({ id: '1', status: 'Invalid' })
  })

  it('is empty when notarytool printed no JSON', () => {
    expect(parseSubmission('Error: no credentials')).toEqual({})
  })
})

describe('the release tag', () => {
  it('is the version and the context', () => {
    expect(versionForTag('desktop/v1.2.0-rc.0')).toBe('1.2.0-rc.0')
    expect(contextForTag('desktop/v1.2.0-rc.0')).toBe('beta')
    expect(contextForTag('desktop/v1.2.0')).toBe('prod')
  })

  it.each(['cli/v1.2.0', 'desktop/v1.2', 'desktop/1.2.0', 'desktop/v1.2.0-beta.1'])(
    'rejects %s',
    (tag) => {
      expect(() => versionForTag(tag)).toThrow(/Not a desktop release tag/)
    },
  )

  it('matches package.json exactly for a candidate', () => {
    expect(() => assertTagMatchesPackage('desktop/v1.2.0-rc.1', '1.2.0-rc.1')).not.toThrow()
    expect(() => assertTagMatchesPackage('desktop/v1.2.0-rc.1', '1.2.0-rc.0')).toThrow(
      /does not match/,
    )
  })

  it('accepts a stable tag on the candidate commit, and nothing else', () => {
    expect(() => assertTagMatchesPackage('desktop/v1.2.0', '1.2.0-rc.3')).not.toThrow()
    expect(() => assertTagMatchesPackage('desktop/v1.2.0', '1.2.0')).not.toThrow()
    expect(() => assertTagMatchesPackage('desktop/v1.3.0', '1.2.0-rc.3')).toThrow(/does not match/)
  })
})
