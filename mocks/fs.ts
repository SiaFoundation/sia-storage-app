import { extFromMime } from '../src/lib/fileTypes'
import { FsFileInfo } from '../src/stores/fs'
import { File } from 'expo-file-system'

type FsMock = {
  getFsFileUri: jest.Mock
  copyFileToFs: jest.Mock
  fsStorageDirectory: {
    info: jest.Mock
    create: jest.Mock
    list: jest.Mock
  }
  listFilesInFsStorageDirectory: jest.Mock
}

function buildMockPath(file: FsFileInfo) {
  return `fs://files/${file.id}.${extFromMime(file.type)}`
}

let current = {
  mock: buildFsMock(),
}

/**
 * Creates a mock of the fs store module with reasonable defaults.
 * These can be overridden by the test suite to provide custom behavior.
 */
export function buildFsMock(): FsMock {
  const cachedIds = new Set()
  const mock = {
    ...jest.requireActual('../src/stores/fs'),
    getFsFileUri: jest.fn(async (file) => {
      if (file.localId) return buildMockPath(file)
      return cachedIds.has(file.id) ? buildMockPath(file) : null
    }),
    getFsFileForId: jest.fn(async (file: FsFileInfo) => {
      return new File(buildMockPath(file))
    }),
    fsStorageDirectory: {
      info: jest.fn(() => ({ exists: true })),
      create: jest.fn(() => {}),
      list: jest.fn(() => []),
    },
    listFilesInFsStorageDirectory: jest.fn(() => []),
  }
  return mock
}

export function setFsMock() {
  current.mock = buildFsMock()
  return current.mock
}
