import { expect, test } from 'bun:test'
import { appStoreConnectToken } from './jwt'

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64',
  )
  return { pair, der }
}

async function verify(token: string, publicKey: CryptoKey): Promise<boolean> {
  const [header, payload, signature] = token.split('.')
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    Buffer.from(signature, 'base64url'),
    new TextEncoder().encode(`${header}.${payload}`),
  )
}

test('an App Store Connect token verifies for a PEM key and for a bare base64 key', async () => {
  const { pair, der } = await keyPair()
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`
  for (const privateKey of [pem, der]) {
    const token = await appStoreConnectToken({ keyId: 'KEY', issuerId: 'ISSUER', privateKey })
    expect(await verify(token, pair.publicKey)).toBe(true)
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'ISSUER', aud: 'appstoreconnect-v1' })
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(20 * 60)
  }
})
