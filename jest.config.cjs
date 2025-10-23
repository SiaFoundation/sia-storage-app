module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFilesAfterEnv: [
    'expo-sqlite-mock/src/setup.ts',
    '<rootDir>/jest.setup.cjs',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@shopify/react-native-skia|react-native-fs|react-native-quick-crypto|expo|@expo|expo-.*|expo-sqlite|expo-modules-core)/)',
  ],
  moduleNameMapper: {},
}
