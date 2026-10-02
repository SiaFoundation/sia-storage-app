import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  loadServeConfig,
  saveServeConfig,
  findRoute,
  isPathServed,
  canList,
  canDownload,
  isNameListed,
  type ServeConfig,
  type RouteConfig,
} from '../../src/serve/access'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-access-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('loadServeConfig', () => {
  it('returns empty routes when file does not exist', () => {
    const config = loadServeConfig(path.join(tempDir, 'serve.json'))
    expect(config.routes).toEqual([])
  })

  it('loads valid config from file', () => {
    const configPath = path.join(tempDir, 'serve.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        routes: [
          { path: 'public', listing: true, download: true, recursive: true },
          { path: 'share', listing: false, download: true },
        ],
      }),
    )
    const config = loadServeConfig(configPath)
    expect(config.routes).toHaveLength(2)
    expect(config.routes[0]).toEqual({
      path: 'public',
      listing: true,
      download: true,
      recursive: true,
    })
    expect(config.routes[1]).toEqual({
      path: 'share',
      listing: false,
      download: true,
      recursive: false,
    })
  })

  it('defaults recursive to false', () => {
    const configPath = path.join(tempDir, 'serve.json')
    fs.writeFileSync(configPath, JSON.stringify({ routes: [{ path: 'test' }] }))
    const config = loadServeConfig(configPath)
    expect(config.routes[0].recursive).toBe(false)
  })
})

describe('saveServeConfig', () => {
  it('writes config and can be re-loaded', () => {
    const configPath = path.join(tempDir, 'serve.json')
    const config: ServeConfig = {
      routes: [{ path: 'docs', listing: true, download: false, recursive: true }],
    }
    saveServeConfig(configPath, config)
    const loaded = loadServeConfig(configPath)
    expect(loaded.routes).toEqual(config.routes)
  })
})

describe('findRoute — non-recursive (default)', () => {
  const config: ServeConfig = {
    routes: [
      { path: 'public', listing: true, download: true, recursive: false },
      { path: 'share', listing: false, download: true, recursive: false },
    ],
  }

  it('matches exact path', () => {
    expect(findRoute('public', config)?.path).toBe('public')
  })

  it('matches one level of children (files in directory)', () => {
    expect(findRoute('public/file.txt', config)?.path).toBe('public')
  })

  it('does NOT match deeper children', () => {
    expect(findRoute('public/sub/file.txt', config)).toBeNull()
  })

  it('matches subdirectories at one level (but not their contents)', () => {
    // public/sub is one level deep — the route covers it
    expect(findRoute('public/sub', config)?.path).toBe('public')
    // But public/sub/file.txt is two levels deep — not covered
    expect(findRoute('public/sub/file.txt', config)).toBeNull()
  })

  it('returns null when no route matches', () => {
    expect(findRoute('unknown', config)).toBeNull()
  })

  it('does not match partial path segments', () => {
    expect(findRoute('publicx/file.txt', config)).toBeNull()
  })
})

describe('findRoute — recursive', () => {
  const config: ServeConfig = {
    routes: [{ path: 'public', listing: true, download: true, recursive: true }],
  }

  it('matches exact path', () => {
    expect(findRoute('public', config)?.path).toBe('public')
  })

  it('matches one level of children', () => {
    expect(findRoute('public/file.txt', config)?.path).toBe('public')
  })

  it('matches deep children', () => {
    expect(findRoute('public/sub/file.txt', config)?.path).toBe('public')
    expect(findRoute('public/a/b/c/d', config)?.path).toBe('public')
  })

  it('matches subdirectories', () => {
    expect(findRoute('public/sub', config)?.path).toBe('public')
  })
})

describe('findRoute — nested route overrides recursive parent', () => {
  const config: ServeConfig = {
    routes: [
      { path: 'site', listing: true, download: true, recursive: true },
      { path: 'site/private', listing: false, download: false, recursive: false },
    ],
  }

  it('parent covers general paths', () => {
    expect(findRoute('site/page.html', config)?.path).toBe('site')
    expect(findRoute('site/assets/style.css', config)?.path).toBe('site')
  })

  it('child overrides parent for its path', () => {
    const route = findRoute('site/private', config)
    expect(route?.path).toBe('site/private')
    expect(route?.listing).toBe(false)
  })

  it('child covers its own files (one level)', () => {
    const route = findRoute('site/private/secret.txt', config)
    expect(route?.path).toBe('site/private')
    expect(route?.download).toBe(false)
  })

  it('child does NOT cover deeper paths (non-recursive)', () => {
    // site/private is non-recursive, so site/private/deep/file falls back to site (recursive)
    const route = findRoute('site/private/deep/file.txt', config)
    expect(route?.path).toBe('site')
  })
})

describe('findRoute — root route', () => {
  it('non-recursive root matches root and one level', () => {
    const config: ServeConfig = {
      routes: [{ path: '', listing: true, download: true, recursive: false }],
    }
    expect(findRoute('', config)).not.toBeNull()
    expect(findRoute('file.txt', config)).not.toBeNull()
    expect(findRoute('subdir', config)).not.toBeNull()
    expect(findRoute('subdir/file.txt', config)).toBeNull()
  })

  it('recursive root matches everything', () => {
    const config: ServeConfig = {
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    }
    expect(findRoute('', config)).not.toBeNull()
    expect(findRoute('anything', config)).not.toBeNull()
    expect(findRoute('deep/path/file.txt', config)).not.toBeNull()
  })

  it('specific route wins over recursive root', () => {
    const config: ServeConfig = {
      routes: [
        { path: '', listing: true, download: true, recursive: true },
        { path: 's', listing: false, download: true, recursive: false },
      ],
    }
    expect(findRoute('s', config)?.path).toBe('s')
    expect(findRoute('s/file.txt', config)?.path).toBe('s')
    // s is non-recursive, so s/sub falls back to recursive root
    expect(findRoute('s/sub/file.txt', config)?.path).toBe('')
  })
})

describe('isPathServed', () => {
  it('returns false with empty config', () => {
    const empty: ServeConfig = { routes: [] }
    expect(isPathServed('anything', empty)).toBe(false)
  })

  it('returns true for paths with matching route', () => {
    const config: ServeConfig = {
      routes: [{ path: 'public', listing: true, download: true, recursive: false }],
    }
    expect(isPathServed('public', config)).toBe(true)
    expect(isPathServed('public/file.txt', config)).toBe(true)
  })

  it('returns false for unmatched paths', () => {
    const config: ServeConfig = {
      routes: [{ path: 'public', listing: true, download: true, recursive: false }],
    }
    expect(isPathServed('private', config)).toBe(false)
    expect(isPathServed('public/sub/deep', config)).toBe(false)
  })
})

describe('canList / canDownload', () => {
  const config: ServeConfig = {
    routes: [
      { path: 'listed', listing: true, download: true, recursive: false },
      { path: 'unlisted', listing: false, download: true, recursive: false },
      { path: 'browse-only', listing: true, download: false, recursive: false },
    ],
  }

  it('canList returns true when listing enabled', () => {
    expect(canList('listed', config)).toBe(true)
  })

  it('canList returns false when listing disabled', () => {
    expect(canList('unlisted', config)).toBe(false)
  })

  it('canDownload returns true when download enabled', () => {
    expect(canDownload('listed/file.txt', config)).toBe(true)
  })

  it('canDownload returns false when download disabled', () => {
    expect(canDownload('browse-only/file.txt', config)).toBe(false)
  })

  it('returns false for no route', () => {
    expect(canList('unknown', config)).toBe(false)
    expect(canDownload('unknown/file.txt', config)).toBe(false)
  })
})

describe('case sensitivity', () => {
  const config: ServeConfig = {
    routes: [{ path: 'Public', listing: true, download: true, recursive: false }],
  }

  it('matching is case-sensitive', () => {
    expect(findRoute('Public', config)).not.toBeNull()
    expect(findRoute('public', config)).toBeNull()
  })
})

describe('listing as name array', () => {
  it('canList returns true for array listing', () => {
    const config: ServeConfig = {
      routes: [{ path: '', listing: ['archives', 'mirrors'], download: true, recursive: true }],
    }
    expect(canList('', config)).toBe(true)
  })

  it('isNameListed filters by array', () => {
    const route: RouteConfig = {
      path: '',
      listing: ['archives', 'mirrors'],
      download: true,
      recursive: true,
    }
    expect(isNameListed('archives', route)).toBe(true)
    expect(isNameListed('mirrors', route)).toBe(true)
    expect(isNameListed('private', route)).toBe(false)
    expect(isNameListed('blog.html', route)).toBe(false)
  })

  it('isNameListed returns true for all when listing is true', () => {
    const route: RouteConfig = {
      path: '',
      listing: true,
      download: true,
      recursive: true,
    }
    expect(isNameListed('anything', route)).toBe(true)
  })

  it('isNameListed returns false for all when listing is false', () => {
    const route: RouteConfig = {
      path: '',
      listing: false,
      download: true,
      recursive: true,
    }
    expect(isNameListed('anything', route)).toBe(false)
  })

  it('loadServeConfig parses array listing', () => {
    const configPath = path.join(tempDir, 'serve.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        routes: [{ path: '', listing: ['photos', 'docs'], download: true }],
      }),
    )
    const config = loadServeConfig(configPath)
    expect(config.routes[0].listing).toEqual(['photos', 'docs'])
  })
})
