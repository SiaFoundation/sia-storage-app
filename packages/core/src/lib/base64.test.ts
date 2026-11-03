import { bytesToBase64 } from './base64'

it('matches Node for every padding length', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 255, 256, 257]) {
    const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 255)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  }
})
