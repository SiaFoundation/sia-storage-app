// biome-ignore lint/style/noRestrictedImports: File constructor + .stream() (async)
import { File } from 'expo-file-system'
import type { Reader } from 'react-native-sia'

/**
 * Creates a Reader interface that wraps a file stream for use with the SDK's
 * packed upload API. The Reader reads chunks from the file until EOF.
 */
export function createFileReader(fileUri: string): Reader {
  const file = new File(fileUri)
  const stream = file.stream()
  const reader = stream.getReader()

  return {
    async read(): Promise<ArrayBuffer> {
      const { done, value } = await reader.read()
      if (done || !value) {
        // Return empty ArrayBuffer to signal EOF
        return new ArrayBuffer(0)
      }
      // Convert Uint8Array to ArrayBuffer
      return value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      )
    },
  }
}
