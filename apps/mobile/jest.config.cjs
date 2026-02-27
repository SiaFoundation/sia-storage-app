module.exports = {
  globalSetup: '<rootDir>/jest.globalSetup.cjs',
  preset: 'jest-expo',
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFilesAfterEnv: [
    'expo-sqlite-mock/src/setup.ts',
    '<rootDir>/jest.setup.cjs',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-fs|react-native-quick-crypto|expo|@expo|expo-.*|expo-sqlite|expo-modules-core|@siastorage)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/scripts/', '/test/'],
  moduleNameMapper: {
    '^@siastorage/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@siastorage/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@siastorage/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^expo-secure-store$': '<rootDir>/test/mocks/expo-secure-store.ts',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/test/mocks/async-storage.ts',
    // Real image manipulation using sharp (unit tests can override with jest.mock)
    '^expo-image-manipulator$': '<rootDir>/test/utils/nodeThumbnails.ts',
    '^expo-video-thumbnails$':
      '<rootDir>/test/mocks/expo-video-thumbnails.ts',
    '^expo-media-library$': '<rootDir>/test/mocks/expo-media-library.ts',
    '^expo-keep-awake$': '<rootDir>/test/mocks/expo-keep-awake.ts',
  },
}
