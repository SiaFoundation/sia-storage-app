import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'

export function createMockFsIO(overrides?: Partial<FsIOAdapter>): FsIOAdapter {
  return {
    exists: async () => true,
    uri: () => 'file://source.jpg',
    size: async () => null,
    remove: async () => {},
    copy: async () => ({ uri: '', size: 0 }),
    writeFile: async (_file, data) => ({
      uri: 'file://thumb.webp',
      size: data.byteLength,
    }),
    list: async () => [],
    ensureDirectory: async () => {},
    ...overrides,
  }
}
