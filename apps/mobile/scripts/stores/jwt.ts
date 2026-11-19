/**
 * Signs the JWTs App Store Connect and Google's token endpoint accept, with
 * the keys from the same secrets the fastlane lanes read.
 */

function base64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  return Buffer.from(bytes).toString('base64url')
}

/** The DER bytes of a PKCS#8 key given as PEM, or as its bare base64 body. */
function pkcs8(key: string): ArrayBuffer {
  const body = key
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(body, 'base64')).buffer
}

async function sign(
  header: object,
  payload: object,
  key: CryptoKey,
  algorithm: AlgorithmIdentifier | EcdsaParams,
): Promise<string> {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  // WebCrypto's ECDSA signature is the raw r||s pair, which is the JWS form.
  const signature = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(input))
  return `${input}.${base64url(signature)}`
}

export async function appStoreConnectToken(apiKey: {
  keyId: string
  issuerId: string
  privateKey: string
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8(apiKey.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  return sign(
    { alg: 'ES256', kid: apiKey.keyId, typ: 'JWT' },
    // App Store Connect refuses a token that lives longer than 20 minutes.
    { iss: apiKey.issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' },
    key,
    { name: 'ECDSA', hash: 'SHA-256' },
  )
}

export async function googleAccessToken(account: {
  client_email: string
  private_key: string
  token_uri?: string
}): Promise<string> {
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token'
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const assertion = await sign(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    },
    key,
    { name: 'RSASSA-PKCS1-v1_5' },
  )
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) {
    throw new Error(`Google token request failed with HTTP ${response.status}`)
  }
  const { access_token } = (await response.json()) as { access_token: string }
  return access_token
}
