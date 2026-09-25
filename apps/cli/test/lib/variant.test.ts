const packageJson = { version: '0.0.6' }
jest.mock('../../package.json', () => packageJson)

import { cliVariant } from '../../src/lib/variant'

describe('the CLI build variant', () => {
  const inherited = process.env.SIA_BUILD_VARIANT

  afterEach(() => {
    packageJson.version = '0.0.6'
    if (inherited === undefined) delete process.env.SIA_BUILD_VARIANT
    else process.env.SIA_BUILD_VARIANT = inherited
  })

  it('is production for a release and beta for a release candidate', () => {
    delete process.env.SIA_BUILD_VARIANT
    expect(cliVariant()).toBe('prod')

    packageJson.version = '0.0.7-rc.0'
    expect(cliVariant()).toBe('beta')
  })

  it('is production for a release built from its candidate commit', () => {
    delete process.env.SIA_BUILD_VARIANT
    packageJson.version = '0.0.7-rc.0'
    const build = globalThis as { SIA_CLI_VERSION?: string }
    build.SIA_CLI_VERSION = '0.0.7'
    try {
      expect(cliVariant()).toBe('prod')
    } finally {
      delete build.SIA_CLI_VERSION
    }
  })

  it('is whatever the desktop app that spawned the daemon says', () => {
    process.env.SIA_BUILD_VARIANT = 'dev'

    expect(cliVariant()).toBe('dev')
  })
})
