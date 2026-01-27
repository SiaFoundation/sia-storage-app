module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFilesAfterEnv: [
    'expo-sqlite-mock/src/setup.ts',
    '<rootDir>/jest.setup.cjs',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-fs|react-native-quick-crypto|expo|@expo|expo-.*|expo-sqlite|expo-modules-core)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/scripts/'],
  moduleNameMapper: {},
}
