// oxlint-disable-next-line no-restricted-imports -- File constructor + .stream() (async)
import { File } from 'expo-file-system'
import type { Reader } from 'react-native-sia'

const CHUNK_SIZE = 256 * 1024

/**
 * Creates a Reader that streams a file via `File.stream()` with a BYOB
 * reader pulling `CHUNK_SIZE`-byte chunks directly into our buffer.
 *
 * Why BYOB: expo-file-system's default ReadableStream pull size is 1KB
 * (see node_modules/expo-file-system/src/streams.ts). A BYOB reader lets
 * us dictate the chunk size — we pass a 256KB view and `pull` reads into
 * it, so we get one native file read per 256KB (vs ~40k per 40MB file).
 *
 * Why not File.open() + handle.readBytes(): synchronous JSI call — panics
 * the SDK's Rust upload task post-0.13.20 (UploadError.Closed before the
 * body runs). Any reader that makes a fresh native read per invocation
 * hits the same panic. File.stream() works because its chunks are
 * pre-buffered into JS memory via the stream machinery before our
 * `read()` returns.
 *
 * Why not File.bytes(): loads the whole file into memory, bad for videos.
 */
export function createFileReader(fileUri: string): Reader {
  const stream = new File(fileUri).stream()
  const streamReader = stream.getReader({ mode: 'byob' })
  return {
    async read(): Promise<ArrayBuffer> {
      const view = new Uint8Array(CHUNK_SIZE)
      const { value, done } = await streamReader.read(view)
      if (done || !value || value.byteLength === 0) return new ArrayBuffer(0)
      // Copy into a fresh JS-owned Uint8Array before handing to uniffi.
      // value's buffer is the one we passed in (after transfer); slicing
      // creates a clean, exact-sized JS-owned ArrayBuffer.
      const owned = new Uint8Array(value.byteLength)
      owned.set(value)
      return owned.buffer
    },
  }
}
