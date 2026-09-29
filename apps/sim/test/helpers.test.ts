import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { diffLibraries } from '../src/converge'
import type { LibraryEntry } from '../src/devices'
import { parseSize, seedFiles, seedPhotos } from '../src/seed'
import { findCenter, findTapPoint, locator, locators } from '../src/ui/tree'

const entry = (id: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id,
  name: `${id}.txt`,
  hash: `hash-${id}`,
  size: 1,
  dir: null,
  current: true,
  trashed: false,
  tags: [],
  uploaded: true,
  ...overrides,
})

describe('diffLibraries', () => {
  test('libraries with the same files agree', () => {
    const files = [entry('a'), entry('b')]
    expect(diffLibraries({ name: 'phone', files }, { name: 'laptop', files })).toEqual([])
  })

  test('names every file one side is missing and every field that differs', () => {
    const diff = diffLibraries(
      { name: 'phone', files: [entry('a'), entry('b', { name: 'new.txt' })] },
      { name: 'laptop', files: [entry('b'), entry('c')] },
    )
    expect(diff).toEqual([
      'a (a.txt) is on phone but not laptop',
      'b name: phone=new.txt laptop=b.txt',
      'c (c.txt) is on laptop but not phone',
    ])
  })

  test('upload state alone is not a difference between libraries', () => {
    expect(
      diffLibraries(
        { name: 'phone', files: [entry('a', { uploaded: false })] },
        { name: 'laptop', files: [entry('a')] },
      ),
    ).toEqual([])
  })
})

describe('diffLibraries on trashed rows', () => {
  test('two trashed copies of a file that differ only in their current flag agree', () => {
    const base = entry('a', { trashed: true })
    expect(
      diffLibraries(
        { name: 'mac', files: [{ ...base, current: false }] },
        { name: 'phone', files: [{ ...base, current: true }] },
      ),
    ).toEqual([])
  })
})

describe('parseSize', () => {
  test('reads bytes and k, m, g suffixes', () => {
    expect(parseSize('512')).toBe(512)
    expect(parseSize('64k')).toBe(65536)
    expect(parseSize('1.5m')).toBe(1.5 * 1024 ** 2)
    expect(parseSize('2g')).toBe(2 * 1024 ** 3)
  })

  test('rejects anything else', () => {
    expect(() => parseSize('lots')).toThrow('Not a size')
  })
})

describe('seedFiles', () => {
  test('writes files of the requested size whose bytes are all different', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-seed-'))
    try {
      const paths = seedFiles(dir, { count: 5, size: 300, prefix: 'x' })
      const contents = paths.map((p) => readFileSync(p))
      expect(contents.every((c) => c.length === 300)).toBe(true)
      expect(new Set(contents.map((c) => c.toString('hex'))).size).toBe(5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses a size too small for the bytes to differ', () => {
    expect(() => seedFiles('/tmp/unused', { count: 2, size: 4 })).toThrow('at least 256 bytes')
  })
})

describe('seedPhotos', () => {
  /** Each chunk as `{ type, data }`, failing on a wrong length or checksum. */
  function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
    const out: Array<{ type: string; data: Buffer }> = []
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at)
      const typeAndData = png.subarray(at + 4, at + 8 + length)
      expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(typeAndData) >>> 0)
      out.push({
        type: typeAndData.subarray(0, 4).toString('ascii'),
        data: typeAndData.subarray(4),
      })
      at += 12 + length
    }
    return out
  }

  test('writes distinct 64x64 RGB PNGs whose pixel data inflates to the declared size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-photos-'))
    try {
      const pngs = seedPhotos(dir, { count: 3 }).map((p) => readFileSync(p))
      for (const png of pngs) {
        expect(png.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'))
        const [ihdr, idat, iend] = chunks(png)
        expect([ihdr.type, idat.type, iend.type]).toEqual(['IHDR', 'IDAT', 'IEND'])
        expect([
          ihdr.data.readUInt32BE(0),
          ihdr.data.readUInt32BE(4),
          ihdr.data[8],
          ihdr.data[9],
        ]).toEqual([64, 64, 8, 2])
        expect(inflateSync(idat.data).length).toBe(64 * (1 + 64 * 3))
      }
      expect(new Set(pngs.map((p) => p.toString('hex'))).size).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('findCenter', () => {
  const ios = (type: string, label: string, x: number) =>
    `<XCUIElementType${type} type="XCUIElementType${type}" label="${label}" x="${x}" y="0" width="10" height="10" visible="true">`

  test('on iOS a button beats static text with the same label, in either order', () => {
    const text = ios('StaticText', 'Delete', 0)
    const button = ios('Button', 'Delete', 100)
    expect(findCenter(`<root>${text}${button}</root>`, { text: 'Delete' }, 'ios')).toEqual([105, 5])
    expect(findCenter(`<root>${button}${text}</root>`, { text: 'Delete' }, 'ios')).toEqual([105, 5])
  })

  test('on iOS an untyped pressable still matches when nothing tappable does', () => {
    const xml = `<root>${ios('Other', 'Add files', 20)}</root>`
    expect(findCenter(xml, { label: 'Add files' }, 'ios')).toEqual([25, 5])
  })

  test('on Android a clickable view beats a label with the same text, in either order, and ids lose the package', () => {
    const label = '<node text="Import" clickable="false" bounds="[0,0][10,10]" />'
    const button =
      '<node text="Import" resource-id="sia.storage.dev:id/import" clickable="true" bounds="[100,0][110,10]" />'
    for (const xml of [`<root>${label}${button}</root>`, `<root>${button}${label}</root>`]) {
      expect(findCenter(xml, { text: 'import' }, 'android')).toEqual([105, 5])
      expect(findCenter(xml, { id: 'import' }, 'android')).toEqual([105, 5])
    }
  })

  test('text in the same case beats a header showing it in capitals, in either order', () => {
    const header = ios('StaticText', 'DEVELOPERS', 0)
    const row = ios('StaticText', 'Developers', 100)
    for (const xml of [`<root>${header}${row}</root>`, `<root>${row}${header}</root>`]) {
      expect(findCenter(xml, { text: 'Developers' }, 'ios')).toEqual([105, 5])
    }
  })

  test('a button in capitals beats a title in the same case as the text', () => {
    const title = ios('StaticText', 'Delete', 0)
    const button = ios('Button', 'DELETE', 100)
    expect(findCenter(`<root>${title}${button}</root>`, { text: 'Delete' }, 'ios')).toEqual([
      105, 5,
    ])
  })

  test('text in another case still matches when nothing matches in case', () => {
    const xml = `<root>${ios('StaticText', 'DEVELOPERS', 0)}</root>`
    expect(findCenter(xml, { text: 'Developers' }, 'ios')).toEqual([5, 5])
  })

  test('a hidden or zero-sized element never matches', () => {
    const xml =
      '<root><XCUIElementTypeButton label="Go" x="0" y="0" width="10" height="10" visible="false">' +
      '<XCUIElementTypeButton label="Go" x="0" y="0" width="0" height="10" visible="true"></root>'
    expect(findCenter(xml, { label: 'Go' }, 'ios')).toBeNull()
  })

  test('an Android label matches a content description that adds a value after it', () => {
    const pill =
      '<node content-desc="Status, No internet connection" clickable="true" bounds="[0,0][10,10]" />'
    const other = '<node content-desc="Status bar" clickable="true" bounds="[20,0][30,10]" />'
    expect(findCenter(`<root>${other}${pill}</root>`, { label: 'Status' }, 'android')).toEqual([
      5, 5,
    ])
    const ios =
      '<XCUIElementTypeButton label="Status, busy" x="0" y="0" width="10" height="10" visible="true">'
    expect(findCenter(`<root>${ios}</root>`, { label: 'Status' }, 'ios')).toBeNull()
  })

  test('an Android value holding double quotes is read from single quotes', () => {
    const xml = `<root><node text='Create "Trips"' clickable="true" bounds="[0,0][10,10]" /></root>`
    expect(findCenter(xml, { contains: 'Create "Trips"' }, 'android')).toEqual([5, 5])
  })

  test('entities in labels are decoded before matching', () => {
    const xml = `<root>${ios('Button', 'Photos &amp; Videos', 0)}</root>`
    expect(findCenter(xml, { label: 'Photos & Videos' }, 'ios')).toEqual([5, 5])
  })
})

describe('locator', () => {
  test('a tap on iOS asks for a tappable element with the text', () => {
    const { using, value } = locator({ text: 'Developers' }, 'ios', true)
    expect(using).toBe('-ios predicate string')
    expect(value).toStartWith('(label ==[c] "Developers" OR ')
    expect(value).toContain('AND type IN {"XCUIElementTypeButton", ')
    expect(value).toEndWith(' AND visible == 1')
  })

  test('text on Android is looked up as text and then as a content description', () => {
    expect(locators({ contains: 'a.bin' }, 'android').map((l) => l.value)).toEqual([
      'new UiSelector().textMatches("(?i).*a\\\\.bin.*")',
      'new UiSelector().descriptionMatches("(?i).*a\\\\.bin.*")',
    ])
    expect(locators({ label: 'Close' }, 'android')).toHaveLength(1)
  })

  test('an id on iOS is an accessibility id unless the lookup wants a tappable one', () => {
    expect(locator({ id: 'x' }, 'ios')).toEqual({ using: 'accessibility id', value: 'x' })
    expect(locator({ id: 'x' }, 'ios', true).value).toStartWith('(name == "x") AND type IN')
  })
})

describe('findTapPoint', () => {
  const node = (attrs: string, bounds: string, children = '') =>
    children
      ? `<node ${attrs} bounds="${bounds}">${children}</node>`
      : `<node ${attrs} bounds="${bounds}" />`
  const backdrop = node('content-desc="Close menu" clickable="true"', '[0,0][1000,1000]')
  const menu = node(
    'clickable="false"',
    '[200,200][800,800]',
    node('text="Date Added" clickable="true"', '[200,200][800,300]') +
      node('text="Name" clickable="true"', '[200,300][800,800]'),
  )
  const inMenu = ([x, y]: [number, number]) => x >= 200 && x < 800 && y >= 200 && y < 800

  test('a backdrop with a menu over its center is tapped where no control is', () => {
    const xml = `<root>${backdrop}${menu}</root>`
    expect(inMenu(findTapPoint(xml, { label: 'Close menu' }, 'android') ?? [500, 500])).toBe(false)
  })

  test('a control earlier in the tree than the backdrop is avoided too', () => {
    const xml = `<root>${menu}${backdrop}</root>`
    expect(inMenu(findTapPoint(xml, { label: 'Close menu' }, 'android') ?? [500, 500])).toBe(false)
  })

  test('a layer a pixel short of the whole screen does not block every point', () => {
    const layer = node('content-desc="Preview not supported" clickable="true"', '[0,0][999,999]')
    const xml = `<root>${layer}${backdrop}${menu}</root>`
    expect(inMenu(findTapPoint(xml, { label: 'Close menu' }, 'android') ?? [500, 500])).toBe(false)
  })

  test('an element smaller than half the screen is tapped at its center', () => {
    const row = node(
      'content-desc="a.bin, 8 KB" clickable="true"',
      '[0,0][100,100]',
      node('content-desc="Status: on device" clickable="true"', '[40,40][60,60]'),
    )
    const xml = `<root>${node('clickable="false"', '[0,0][1000,1000]', row)}</root>`
    expect(findTapPoint(xml, { contains: 'a.bin' }, 'android')).toEqual([50, 50])
  })
})
