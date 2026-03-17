module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  maxWorkers: 8,
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  transform: {
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
            '@siastorage/sdk-mock': ['../../packages/sdk-mock/src/index.ts'],
            '@siastorage/node-adapters/*': ['../../packages/node-adapters/src/*'],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@siastorage/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@siastorage/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@siastorage/sdk-mock$': '<rootDir>/../../packages/sdk-mock/src/index.ts',
    '^@siastorage/node-adapters/(.*)$': '<rootDir>/../../packages/node-adapters/src/$1',
  },
}
