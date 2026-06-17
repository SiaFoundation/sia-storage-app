import { requireOptionalNativeModule } from 'expo'

/**
 * media-observer — the photo library's insertion cursor.
 *
 * `changesSince(cursor)` returns the asset ids added to the library since the
 * cursor, plus the cursor to use next time. The cursor is an opaque bookmark
 * into the platform's change history (iOS PhotoKit change token, Android
 * MediaStore generation), so additions made while the app was not running are
 * still reported on the next call — a live change observer cannot do that.
 *
 * Detection is by what the system actually added, so an old-dated photo just
 * AirDropped/iCloud-synced (iOS) or a file with no capture date (Android) is
 * reported, while a metadata change to an existing photo is not. Ids match
 * expo-media-library's `Asset.id`.
 */
export type MediaChanges = {
  /** Asset ids added since the cursor. */
  inserted: string[]
  /** Opaque cursor to persist and pass to the next call. */
  cursor: string
}

type NativeModule = {
  currentCursor(): Promise<string>
  changesSince(cursor: string | null): Promise<MediaChanges>
}

const native = requireOptionalNativeModule<NativeModule>('MediaObserver')

/** A cursor anchored at the current library state, reporting no additions. */
export function currentCursor(): Promise<string> {
  return nativeModule().currentCursor()
}

/**
 * Asset ids added since `cursor`, plus the next cursor. A cursor that can't be
 * honored (first run, expired, too large) reports no additions and returns a
 * fresh cursor anchored at now — the gap is the archive sync's job.
 */
export function changesSince(cursor: string | null): Promise<MediaChanges> {
  return nativeModule().changesSince(cursor)
}

function nativeModule(): NativeModule {
  if (native) return native
  throw new Error('media-observer: native module missing — run expo prebuild --clean.')
}
