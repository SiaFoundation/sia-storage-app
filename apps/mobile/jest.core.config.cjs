/**
 * Jest configuration for core tests.
 *
 * Separate from the main jest.config.cjs to avoid mock conflicts.
 * Core tests boot the full app with real timers and services.
 */
module.exports = {
  globalSetup: '<rootDir>/jest.globalSetup.cjs',
  preset: 'jest-expo',
  testEnvironment: 'node',
  testTimeout: 60000,
  // Only run core tests
  testMatch: ['<rootDir>/test/*.test.ts'],
  // Use only the integration setup, NOT the main jest.setup.cjs
  setupFilesAfterEnv: [
    'expo-sqlite-mock/src/setup.ts',
    '<rootDir>/test/utils/setup.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-fs|react-native-quick-crypto|expo|@expo|expo-.*|expo-sqlite|expo-modules-core|@siastorage)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/scripts/'],
  moduleNameMapper: {
    '^@siastorage/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@siastorage/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@siastorage/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^expo-secure-store$': '<rootDir>/test/mocks/expo-secure-store.ts',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/test/mocks/async-storage.ts',
    // Real image manipulation using sharp (same algorithms as Expo's libvips)
    '^expo-image-manipulator$': '<rootDir>/test/utils/nodeThumbnails.ts',
    // Stub - would need ffmpeg for real video thumbnails
    '^expo-video-thumbnails$':
      '<rootDir>/test/mocks/expo-video-thumbnails.ts',
    // Full in-memory simulation of media library
    '^expo-media-library$': '<rootDir>/test/mocks/expo-media-library.ts',
    '^expo-keep-awake$': '<rootDir>/test/mocks/expo-keep-awake.ts',
  },
}
