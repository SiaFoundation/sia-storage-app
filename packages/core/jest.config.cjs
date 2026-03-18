module.exports = {
  maxWorkers: 8,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
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
            '@siastorage/logger': ['../logger/src/index.ts'],
            '@siastorage/core/*': ['src/*/index.ts'],
            '@siastorage/node-adapters/*': ['../node-adapters/src/*'],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@siastorage/logger$': '<rootDir>/../logger/src/index.ts',
    '^@siastorage/core/(.*)$': '<rootDir>/src/$1/index.ts',
    '^@siastorage/node-adapters/(.*)$': '<rootDir>/../node-adapters/src/$1',
  },
}
