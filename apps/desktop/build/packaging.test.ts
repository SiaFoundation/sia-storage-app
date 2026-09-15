import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { envOverrides, loadEnv, parseEnv, resolveEnv } from './env'
import { plist } from './darwin'
import { replaceableShim, resolveCli } from './install'
import {
  appEntitlements,
  assertNoForbiddenEntitlements,
  extensionEntitlements,
  helperEntitlements,
  nestedExecutables,
} from './sign'

const env = {
  teamId: 'TEAM123',
  signIdentity: 'ABCDEF',
  appBundleId: 'sia.storage.desktop.dev',
  extBundleId: 'sia.storage.desktop.dev.file-provider',
  fileProviderGroup: 'group.TEAM123.sia.storage.desktop.dev.fileprovider',
  appProfile: '/tmp/app.provisionprofile',
  extProfile: '/tmp/ext.provisionprofile',
  domainId: 'sia-dev',
  domainDisplay: 'Sia Storage Dev',
  appName: 'Sia Storage Dev',
}

describe('entitlements', () => {
  it('never requests the entitlements that make amfi kill the app', () => {
    for (const plist of [appEntitlements(env), extensionEntitlements(env), helperEntitlements()]) {
      expect(plist).not.toContain('fileprovider.testing-mode')
      expect(plist).not.toContain('com.apple.developer.team-identifier')
    }
  })

  it.each([
    '<key>com.apple.developer.fileprovider.testing-mode</key><true/>',
    '<key>com.apple.developer.team-identifier</key><string>X</string>',
  ])('rejects a plist carrying %s', (bad) => {
    expect(() => assertNoForbiddenEntitlements(bad, 'test')).toThrow(/amfi/)
  })

  it('gives the app the JIT entitlements the daemon needs', () => {
    const plist = appEntitlements(env)

    expect(plist).toContain('com.apple.security.cs.allow-jit')
    expect(plist).toContain('com.apple.security.cs.allow-unsigned-executable-memory')
  })

  it('sandboxes the extension and not the app', () => {
    expect(extensionEntitlements(env)).toContain('com.apple.security.app-sandbox')
    expect(appEntitlements(env)).not.toContain('com.apple.security.app-sandbox')
  })

  it('escapes a value that would otherwise break the plist', () => {
    const text = appEntitlements({ ...env, appBundleId: 'sia.storage & co' })
    expect(text).toContain('&amp;')
    expect(text).not.toContain('& co')
  })

  it('throws on a number rather than writing an empty dict', () => {
    expect(() => plist({ CFBundleVersion: 1 })).toThrow(/cannot represent number/)
  })

  it('scopes each application identifier to its own bundle', () => {
    expect(appEntitlements(env)).toContain('TEAM123.sia.storage.desktop.dev<')
    expect(extensionEntitlements(env)).toContain('TEAM123.sia.storage.desktop.dev.file-provider<')
  })
})

describe('executables nested in the frameworks', () => {
  it('finds a bare Mach-O by its magic and skips dylibs, helper apps, framework binaries, links and scripts', () => {
    // Under an .app, as in a real bundle, so the helper-app exclusion has to
    // look at the path inside the frameworks directory and not above it.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-frameworks-'))
    const dir = path.join(root, 'Sia Storage.app', 'Contents', 'Frameworks')
    const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0])
    const write = (rel: string, content: Buffer | string) => {
      const target = path.join(dir, rel)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, { mode: 0o755 })
      return target
    }
    try {
      const crashpad = write(
        'Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
        machO,
      )
      const shipIt = write('Squirrel.framework/Versions/A/Resources/ShipIt', machO)
      write('Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib', machO)
      write('Electron Helper.app/Contents/MacOS/Electron Helper', machO)
      write('Squirrel.framework/Versions/A/Resources/script.sh', '#!/bin/sh\n')
      fs.writeFileSync(path.join(dir, 'Squirrel.framework/Versions/A/Resources/data'), machO, {
        mode: 0o644,
      })
      // The framework's own binary and the links Apple's layout puts over it.
      write('Squirrel.framework/Versions/A/Squirrel', machO)
      fs.symlinkSync('A', path.join(dir, 'Squirrel.framework/Versions/Current'))
      fs.symlinkSync('Versions/Current/Squirrel', path.join(dir, 'Squirrel.framework/Squirrel'))

      expect(nestedExecutables(dir).sort()).toEqual([crashpad, shipIt].sort())
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('what the CLI shim may replace', () => {
  it('a missing file and its own previous shim, and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-shim-'))
    const target = path.join(dir, 'sia')
    try {
      expect(replaceableShim(target)).toBe(true)
      fs.writeFileSync(target, '#!/bin/sh\nexec "/x/bun" "/x/daemon.js" "$@"\n')
      expect(replaceableShim(target)).toBe(true)
      fs.writeFileSync(target, 'a user binary')
      expect(replaceableShim(target)).toBe(false)
      fs.writeFileSync(target, '#!/bin/sh\n# wraps daemon.js\nexec /somewhere/else "$@"\n')
      expect(replaceableShim(target)).toBe(false)
      fs.rmSync(target)
      fs.symlinkSync('/usr/bin/true', target)
      expect(replaceableShim(target)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the CLI shim', () => {
  const shim = '/Users/x/.local/bin/sia'

  it('reports the shim when nothing else on PATH provides sia', () => {
    const result = resolveCli('/usr/bin:/Users/x/.local/bin', shim, (p) => p === shim)

    expect(result.effective).toBe(true)
    expect(result.shadowedBy).toBeNull()
  })

  it('names the CLI that wins when it comes first on PATH', () => {
    // apps/cli/install.sh installs to ~/.sia/bin and prepends it, so the
    // standalone CLI shadows the shim and the two can be different builds.
    const standalone = '/Users/x/.sia/bin/sia'
    const result = resolveCli('/Users/x/.sia/bin:/Users/x/.local/bin', shim, (p) =>
      [shim, standalone].includes(p),
    )

    expect(result.effective).toBe(false)
    expect(result.shadowedBy).toBe(standalone)
  })

  it('reports no winner when the shim is not on PATH at all', () => {
    const result = resolveCli('/usr/bin', shim, () => false)

    expect(result.effective).toBe(false)
    expect(result.shadowedBy).toBeNull()
  })
})

describe('build settings', () => {
  it('reads values and ignores comments and blanks', () => {
    const parsed = parseEnv('# a comment\n\nSIA_TEAM_ID=ABC\nSIA_APP_NAME="Sia Storage Dev"\n')

    expect(parsed.SIA_TEAM_ID).toBe('ABC')
    expect(parsed.SIA_APP_NAME).toBe('Sia Storage Dev')
  })

  it('keeps an equals sign inside a value', () => {
    expect(parseEnv('SIA_SIGN_IDENTITY=a=b').SIA_SIGN_IDENTITY).toBe('a=b')
  })

  it('names every missing setting rather than failing at codesign time', () => {
    expect(() => resolveEnv({ SIA_TEAM_ID: 'ABC' }, 'dev.env')).toThrow(/SIA_SIGN_IDENTITY/)
    expect(() => resolveEnv({ SIA_TEAM_ID: 'ABC' }, 'dev.env')).toThrow(/SIA_EXT_PROFILE/)
  })

  it('treats a blank value as missing', () => {
    expect(() => resolveEnv({ SIA_TEAM_ID: 'ABC', SIA_SIGN_IDENTITY: '   ' }, 'dev.env')).toThrow(
      /SIA_SIGN_IDENTITY/,
    )
  })

  it('names a profile that is not on disk', () => {
    const values = Object.fromEntries([
      ['SIA_TEAM_ID', env.teamId],
      ['SIA_SIGN_IDENTITY', env.signIdentity],
      ['SIA_APP_BUNDLE_ID', env.appBundleId],
      ['SIA_EXT_BUNDLE_ID', env.extBundleId],
      ['SIA_FILEPROVIDER_GROUP', env.fileProviderGroup],
      ['SIA_APP_PROFILE', '/nowhere/app.provisionprofile'],
      ['SIA_EXT_PROFILE', '/nowhere/ext.provisionprofile'],
      ['SIA_DOMAIN_ID', env.domainId],
      ['SIA_DOMAIN_DISPLAY', env.domainDisplay],
      ['SIA_APP_NAME', env.appName],
    ])

    expect(() => resolveEnv(values, 'dev.env')).toThrow(/SIA_APP_PROFILE names no file/)
  })

  it('takes only the SIA_* settings from an environment, and not blank ones', () => {
    expect(envOverrides({ SIA_TEAM_ID: 'ABC', SIA_APP_NAME: ' ', PATH: '/bin' })).toEqual({
      SIA_TEAM_ID: 'ABC',
    })
  })

  // The beta context has no gitignored beta.env on a CI runner or a fresh
  // checkout, so these read the committed example plus an environment.
  describe('from the example file plus the environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-profiles-'))
    const profile = path.join(dir, 'app.provisionprofile')
    fs.writeFileSync(profile, '')
    const environment = {
      SIA_TEAM_ID: 'TEAM123',
      SIA_SIGN_IDENTITY: 'ABCDEF',
      SIA_FILEPROVIDER_GROUP: 'group.TEAM123.sia.storage.desktop.beta.fileprovider',
      SIA_APP_PROFILE: profile,
      SIA_EXT_PROFILE: profile,
    }

    it('fills the five blanks and keeps the identity from the file', () => {
      const env = loadEnv('beta', environment)

      expect(env.teamId).toBe('TEAM123')
      expect(env.appBundleId).toBe('sia.storage.desktop.beta')
      expect(env.appName).toBe('Sia Storage Beta')
    })

    it('lets the environment override an identity value too', () => {
      expect(loadEnv('beta', { ...environment, SIA_APP_NAME: 'Renamed' }).appName).toBe('Renamed')
    })

    it('asks for the env file when the environment carries nothing', () => {
      expect(() => loadEnv('beta', { PATH: '/bin' })).toThrow(/Copy beta.example.env/)
    })

    it('rejects a context with no example file', () => {
      expect(() => loadEnv('staging', environment)).toThrow(/No such build context: staging/)
    })
  })
})
