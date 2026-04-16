const sharedTransform = {
  '^.+\\.tsx?$': [
    'ts-jest',
    {
      tsconfig: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: true,
        baseUrl: '.',
        paths: {
          '@siastorage/logger': ['../../packages/logger/src/index.ts'],
          '@siastorage/core/*': ['../../packages/core/src/*'],
          '@siastorage/node-adapters': ['../../packages/node-adapters/src/index.ts'],
          '@siastorage/node-adapters/*': ['../../packages/node-adapters/src/*'],
          '@siastorage/sdk-mock': ['../../packages/sdk-mock/src/index.ts'],
          '@siafoundation/sia-storage': [
            '../../node_modules/@siafoundation/sia-storage/dist/index.node.d.ts',
          ],
          'bun:sqlite': ['./test/__mocks__/bun-sqlite.ts'],
        },
      },
    },
  ],
}

const sharedModuleNameMapper = {
  '^@siastorage/logger$': '<rootDir>/../../packages/logger/src/index.ts',
  '^@siastorage/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
  '^@siastorage/node-adapters$': '<rootDir>/../../packages/node-adapters/src/index.ts',
  '^@siastorage/node-adapters/(.*)$': '<rootDir>/../../packages/node-adapters/src/$1',
  '^@siastorage/sdk-mock$': '<rootDir>/../../packages/sdk-mock/src/index.ts',
  '^@siafoundation/sia-storage$': '<rootDir>/test/__mocks__/@siafoundation/sia-storage.ts',
  '^bun:sqlite$': '<rootDir>/test/__mocks__/bun-sqlite.ts',
}

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/**/*.test.ts'],
      testPathIgnorePatterns: ['<rootDir>/test/e2e/'],
      transform: sharedTransform,
      moduleNameMapper: sharedModuleNameMapper,
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      maxWorkers: 4,
      testMatch: ['<rootDir>/test/e2e/**/*.test.ts'],
      setupFiles: ['<rootDir>/test/e2e/setup.ts'],
      transform: sharedTransform,
      moduleNameMapper: sharedModuleNameMapper,
    },
  ],
}
