module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  testMatch: ['<rootDir>/test/**/*.test.ts'],
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
            '@siafoundation/sia-storage': [
              '../../node_modules/@siafoundation/sia-storage/dist/index.node.d.ts',
            ],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@siastorage/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@siastorage/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
  },
}
