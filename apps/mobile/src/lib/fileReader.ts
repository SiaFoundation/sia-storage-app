// oxlint-disable-next-line no-restricted-imports -- File constructor + .open() (sync native reads)
import { File } from 'expo-file-system'
import type { Reader } from 'react-native-sia'

// Read 256KB at a time. The previous stream-based approach used 1KB chunks
// (expo-file-system's default), meaning ~40,000 reads per 40MB file.
const CHUNK_SIZE = 256 * 1024

/**
 * Creates a Reader interface that reads file data for the SDK's packed upload
 * API using direct FileHandle.readBytes() instead of File.stream().
 *
 * Why not streams: File.stream() goes through web-streams-polyfill which calls
 * structuredClone (@ungap/structured-clone → pair()) on every chunk enqueued
 * to the ReadableStream. With 1KB default chunks, that's ~40k clones per 40MB
 * file — profiling showed pair() consuming ~34% of total JS CPU during uploads.
 *
 * Direct readBytes() is synchronous but at 256KB chunks it's negligible per
 * call and eliminates the polyfill overhead entirely. Profiled result: file
 * reading dropped from 34% CPU to <1.5%.
 */
export function createFileReader(fileUri: string): Reader {
  const file = new File(fileUri)
  const handle = file.open()

  return {
    async read(): Promise<ArrayBuffer> {
      const bytes = handle.readBytes(CHUNK_SIZE)
      if (bytes.length === 0) {
        handle.close()
        return new ArrayBuffer(0)
      }
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}
