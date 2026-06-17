// Stub for the native media-observer module. The real module reads PhotoKit /
// MediaStore change history in native code, which can't run under jest; tests
// that exercise the cursor mock this module inline (jest.mock).
export type MediaChanges = { inserted: string[]; cursor: string }

export async function currentCursor(): Promise<string> {
  return 'v1:mock'
}

export async function changesSince(_cursor: string | null): Promise<MediaChanges> {
  return { inserted: [], cursor: 'v1:mock' }
}
