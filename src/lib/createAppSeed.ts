import 'react-native-get-random-values'

export function createAppSeed() {
  const newSeed = new Uint8Array(32)
  crypto.getRandomValues(newSeed)
  if (newSeed.length !== 32) throw new Error('createAppSeed seed length error')
  return newSeed
}
