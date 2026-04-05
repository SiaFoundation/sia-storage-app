export type ExpoFileSystemMock = {
  File: new (...args: any[]) => {
    uri: string
    name: string
    info: jest.Mock
    bytes: jest.Mock
    write: jest.Mock
    delete: jest.Mock
    copy: jest.Mock
  }
  Directory: new (...args: any[]) => {
    uri: string
    info: jest.Mock
    list: jest.Mock
    create: jest.Mock
    delete: jest.Mock
  }
  Paths: { document: string; cache: string }
}

let methods = buildExpoFileSystemMockMethods()
let mock = buildExpoFileSystemMock()

type CustomMocks = {
  File?: {
    info?: jest.Mock
    bytes?: jest.Mock
    write?: jest.Mock
    list?: jest.Mock
    create?: jest.Mock
    delete?: jest.Mock
    copy?: jest.Mock
  }
  Directory?: {
    info?: jest.Mock
    list?: jest.Mock
    create?: jest.Mock
    delete?: jest.Mock
  }
}

type ExpoFileSystemMockMethods = {
  File: {
    info: jest.Mock
    bytes: jest.Mock
    write: jest.Mock
    list: jest.Mock
    create: jest.Mock
    delete: jest.Mock
    copy: jest.Mock
  }
  Directory: {
    info: jest.Mock
    list: jest.Mock
    create: jest.Mock
    delete: jest.Mock
  }
}

function buildExpoFileSystemMockMethods(customMocks: CustomMocks = {}): ExpoFileSystemMockMethods {
  return {
    File: {
      info: jest.fn((uri: string) => ({ exists: true, size: 100, uri })),
      bytes: jest.fn(() => new Uint8Array(100)),
      write: jest.fn(() => {}),
      list: jest.fn(() => []),
      create: jest.fn(() => {}),
      delete: jest.fn(() => {}),
      copy: jest.fn(() => {}),
      ...customMocks.File,
    },
    Directory: {
      info: jest.fn((_uri: string) => ({ exists: true })),
      list: jest.fn(() => []),
      create: jest.fn(() => {}),
      delete: jest.fn(() => {}),
      ...customMocks.Directory,
    },
  }
}
/**
 * Creates a mock of the Expo FileSystem API with reasonable defaults.
 * These can be overridden by the test suite to provide custom behavior.
 */
export function buildExpoFileSystemMock(): ExpoFileSystemMock {
  class MockDirectory {
    uri: string
    constructor(root: string, name: string) {
      this.uri = `${root}/${name}`
    }
    info = methods.Directory.info
    list = methods.Directory.list
    create = methods.Directory.create
    delete = methods.Directory.delete
  }

  class MockFile {
    uri: string
    name: string
    constructor(dirOrUri: any, name?: string) {
      if (typeof dirOrUri === 'string' && typeof name === 'string') {
        this.uri = `${dirOrUri}/${name}`
        this.name = name
      } else if (dirOrUri && typeof dirOrUri.uri === 'string' && name) {
        this.uri = `${dirOrUri.uri}/${name}`
        this.name = name
      } else if (typeof dirOrUri === 'string') {
        this.uri = dirOrUri
        const parts = dirOrUri.split('/')
        this.name = parts.pop() || dirOrUri
      } else {
        this.uri = 'file://mock'
        this.name = 'mock'
      }
    }
    info = methods.File.info
    bytes = methods.File.bytes
    write = methods.File.write
    list = methods.File.list
    create = methods.File.create
    delete = methods.File.delete
    copy = methods.File.copy
  }
  const mock = {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'document', cache: 'cache' },
  }
  return mock
}

export function setExpoFileSystemMock(): ExpoFileSystemMock {
  mock = buildExpoFileSystemMock()
  return mock
}

export function setExpoFileSystemMockMethods(
  customMocks: CustomMocks = {},
): ExpoFileSystemMockMethods {
  methods = buildExpoFileSystemMockMethods(customMocks)
  return methods
}
