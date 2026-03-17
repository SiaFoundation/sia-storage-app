import { File } from 'expo-file-system'
import { extFromMime } from '../src/lib/fileTypes'
import type { FsFileInfo } from '../src/stores/fs'

type FsMock = {
  copyFileToFs: jest.Mock
  fsStorageDirectory: {
    info: jest.Mock
    create: jest.Mock
    list: jest.Mock
  }
}

function buildMockPath(file: FsFileInfo) {
  return `fs://files/${file.id}.${extFromMime(file.type)}`
}

const current = {
  mock: buildFsMock(),
}

/**
 * Creates a mock of the fs store module with reasonable defaults.
 * These can be overridden by the test suite to provide custom behavior.
 */
export function buildFsMock(): FsMock {
  const mock = {
    ...jest.requireActual('../src/stores/fs'),
    getFsFileForId: jest.fn(async (file: FsFileInfo) => {
      return new File(buildMockPath(file))
    }),
    fsStorageDirectory: {
      info: jest.fn(() => ({ exists: true })),
      create: jest.fn(() => {}),
      list: jest.fn(() => []),
    },
  }
  return mock
}

export function setFsMock() {
  current.mock = buildFsMock()
  return current.mock
}
