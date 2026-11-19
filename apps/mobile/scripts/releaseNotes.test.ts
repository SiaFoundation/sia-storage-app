import { describe, expect, test } from 'bun:test'
import {
  type AppTesting,
  type Item,
  type RoundChanges,
  type WhatsNewEntry,
  NOTHING_NEW,
  candidateChanges,
  changelogSections,
  entryPlatforms,
  notesFor,
  parseChangeset,
  parseGenerated,
  parseTesting,
  parseWhatsNew,
  readTesting,
  readWhatsNew,
  storeText,
  testerNotesText,
} from './releaseNotes'

const changelog = `# Changelog

All notable changes to Sia Storage will be documented in this file.

## 1.16.0-rc.1 (2026-11-20)

### Features

- Folders can be shared.
- Photos import faster.

### Fixes

#### Uploads resume after a crash

The upload queue is restored on launch.

## 1.16.0-rc.0 (2026-11-18)

### Features

- Photos import faster.

## 1.15.1 (2026-11-10)

### Fixes

- Fixed a crash.
`

describe('reading the mobile changelog', () => {
  test('a bullet and a heading with its paragraph are one entry each', () => {
    expect(changelogSections(changelog)[0]).toEqual({
      version: '1.16.0-rc.1',
      entries: [
        'Folders can be shared.',
        'Photos import faster.',
        'Uploads resume after a crash The upload queue is restored on launch.',
      ],
    })
  })

  const platforms = (entry: string): Item['platforms'] =>
    entry === 'Photos import faster.' ? ['ios'] : ['ios', 'android']

  test('a candidate after a candidate numbers the entries new since that candidate', () => {
    const changes = candidateChanges(changelog, '1.16.0-rc.1', platforms)
    expect(changes.from).toBe('1.15.1')
    expect(changes.entries.map((e) => e.text)).toEqual([
      'Folders can be shared.',
      'Photos import faster.',
      'Uploads resume after a crash The upload queue is restored on launch.',
    ])
    expect(changes.entries[1].platforms).toEqual(['ios'])
    expect(changes.candidate).toEqual({ from: '1.16.0-rc.0', numbers: [1, 3] })
  })

  test('the first candidate after a stable release has no previous candidate', () => {
    const rest = changelog.slice(changelog.indexOf('## 1.16.0-rc.0'))
    const changes = candidateChanges(rest, '1.16.0-rc.0', platforms)
    expect(changes.candidate).toBeNull()
    expect(changes.from).toBe('1.15.1')
  })

  test('a changelog whose newest section is another version is refused', () => {
    expect(() => candidateChanges(changelog, '1.16.0-rc.2', platforms)).toThrow('1.16.0-rc.1')
  })
})

describe("a changeset's platforms", () => {
  const finder = parseChangeset(
    '---\ndesktop: patch\ncore: patch\nplatforms: macos\n---\n\n#### Finder keeps it\n\nOnce on the Mac.\n',
  )

  test('the platforms line is read apart from the packages', () => {
    expect(finder).toEqual({
      packages: ['desktop', 'core'],
      platforms: ['macos'],
      text: '#### Finder keeps it Once on the Mac.',
    })
  })

  test('a changelog entry takes the platforms of the changeset it was written from', () => {
    const plain = parseChangeset('---\ndesktop: patch\n---\n\nShared everywhere.\n')
    const iosOnly = parseChangeset(
      '---\nmobile: patch\nplatforms: ios\n---\n\nWorks with iCloud.\n',
    )
    const all = [plain, iosOnly]
    expect(entryPlatforms('mobile', 'Works with iCloud.', all)).toEqual(['ios'])
    expect(entryPlatforms('desktop', 'Shared everywhere.', all)).toEqual(['macos'])
    expect(entryPlatforms('mobile', 'No changeset says this.', all)).toEqual(['ios', 'android'])
  })

  test('a platforms line naming no platform of the app applies to all of them', () => {
    const windowsOnly = parseChangeset(
      '---\ndesktop: patch\nplatforms: windows\n---\n\nExplorer.\n',
    )
    expect(entryPlatforms('desktop', 'Explorer.', [windowsOnly])).toEqual(['macos'])
  })
})

const entry: WhatsNewEntry = {
  version: '1.16.0',
  released: null,
  items: [
    { text: 'Share whole folders.', platforms: ['ios', 'android'] },
    { text: 'Better VoiceOver support.', platforms: ['ios'] },
    { text: 'Better TalkBack support.', platforms: ['android'] },
  ],
}

describe("What's New", () => {
  test('each store gets the shared items and its own', () => {
    expect(storeText(entry, 'ios')).toBe('- Share whole folders.\n- Better VoiceOver support.')
    expect(storeText(entry, 'android')).toBe('- Share whole folders.\n- Better TalkBack support.')
  })

  test('a store with nothing new in a version gets the generic line', () => {
    const iosOnly: WhatsNewEntry = { ...entry, items: [entry.items[1]] }
    expect(storeText(iosOnly, 'android')).toBe(`- ${NOTHING_NEW}`)
  })

  test('a candidate version, an unknown platform and an unknown field are refused', () => {
    expect(() => parseWhatsNew([{ ...entry, version: '1.16.0-rc.1' }], 'mobile')).toThrow(
      'plain X.Y.Z',
    )
    expect(() =>
      parseWhatsNew([{ ...entry, items: [{ text: 'x', platforms: ['macos'] }] }], 'mobile'),
    ).toThrow('platforms')
    expect(() => parseWhatsNew([{ ...entry, note: 'x' }], 'mobile')).toThrow('unknown fields')
  })

  test('the checked-in files are valid', () => {
    expect(readWhatsNew('mobile').length).toBeGreaterThan(0)
    expect(() => readWhatsNew('desktop')).not.toThrow()
    expect(() => readTesting()).not.toThrow()
  })
})

const both = ['ios', 'android'] as const
const testing: AppTesting = {
  version: '1.16.0-rc.1',
  sinceCandidate: {
    from: '1.16.0-rc.0',
    items: [{ text: 'Folders can be shared.', platforms: [...both] }],
  },
  sinceRelease: {
    from: '1.15.1',
    items: [
      { text: 'Folders can be shared.', platforms: [...both] },
      { text: 'Photos import faster.', platforms: [...both] },
      { text: 'iCloud photos import.', platforms: ['ios'] },
    ],
  },
}

describe('tester notes', () => {
  test('TestFlight gets both lists of iOS items and the changelog link', () => {
    expect(testerNotesText(testing, 'ios')).toBe(
      [
        'Since 1.16.0-rc.0:',
        '- Folders can be shared.',
        '',
        'Everything in 1.16.0 since 1.15.1:',
        '- Folders can be shared.',
        '- Photos import faster.',
        '- iCloud photos import.',
        '',
        'Full changelog: https://github.com/SiaFoundation/sia-storage-app/releases/tag/mobile/v1.16.0-rc.1',
      ].join('\n'),
    )
  })

  test('a platform with no changes since the last candidate says so', () => {
    const iosOnly: AppTesting = {
      ...testing,
      sinceCandidate: {
        from: '1.16.0-rc.0',
        items: [{ text: 'iCloud photos import.', platforms: ['ios'] }],
      },
    }
    expect(testerNotesText(iosOnly, 'android')).toStartWith('Since 1.16.0-rc.0:\n- No changes.')
  })

  test('a long list is cut from the end to fit Play, keeping the changelog link', () => {
    const long: AppTesting = {
      ...testing,
      sinceRelease: {
        from: '1.15.1',
        items: Array(20).fill({ text: 'x'.repeat(40), platforms: ['android'] }),
      },
    }
    const text = testerNotesText(long, 'android')
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).toStartWith('Since 1.16.0-rc.0:\n- Folders can be shared.\n\nEverything in 1.16.0')
    expect(text).toEndWith(
      '- More in the full changelog.\n\nFull changelog: https://github.com/SiaFoundation/sia-storage-app/releases/tag/mobile/v1.16.0-rc.1',
    )
  })

  test('the candidate list is cut too once the release list is gone', () => {
    const long: AppTesting = {
      ...testing,
      sinceCandidate: {
        from: '1.16.0-rc.0',
        items: Array(20).fill({ text: 'y'.repeat(40), platforms: ['android'] }),
      },
    }
    const text = testerNotesText(long, 'android')
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).not.toContain('Everything in')
    expect(text).toContain('- More in the full changelog.')
  })

  test('notes left from an earlier candidate are not used for the next one', () => {
    expect(notesFor({ mobile: testing }, 'mobile', '1.16.0-rc.1')).toBe(testing)
    expect(notesFor({ mobile: testing }, 'mobile', '1.16.0-rc.2')).toBeNull()
    expect(notesFor({ mobile: testing }, 'desktop', '0.0.3-rc.0')).toBeNull()
  })

  test('a desktop item for a platform the desktop release does not build is refused', () => {
    const desktop = { ...testing, version: '0.0.3-rc.0', sinceCandidate: null }
    expect(() =>
      parseTesting({
        desktop: {
          ...desktop,
          sinceRelease: { from: null, items: [{ text: 'x', platforms: ['windows'] }] },
        },
      }),
    ).toThrow('needs platforms from macos')
    expect(() => parseTesting({ web: desktop })).toThrow('unknown apps web')
  })
})

function changes(platforms: Item['platforms'][], fresh: number[] | null): RoundChanges['mobile'] {
  return {
    version: 'x',
    from: null,
    entries: platforms.map((p, i) => ({ text: `entry ${i + 1}`, platforms: p })),
    candidate: fresh && { from: 'y', numbers: fresh },
  }
}

describe("the model's reply", () => {
  const both: Item['platforms'] = ['ios', 'android']
  const round: RoundChanges = {
    mobile: changes([both, ['ios']], [2]),
    desktop: changes([['macos']], [1]),
  }
  const desktopNew = [{ text: 'Finder.', entries: [1] }]
  const reply = (mobileNew: unknown, mobileCandidate: unknown = [{ text: 'b', entries: [2] }]) =>
    JSON.stringify({
      whatsNew: { mobile: mobileNew, desktop: desktopNew },
      testing: {
        mobile: { sinceCandidate: mobileCandidate, sinceRelease: [{ text: 'a', entries: [1] }] },
        desktop: {
          sinceCandidate: [{ text: 'd', entries: [1] }],
          sinceRelease: [{ text: 'd', entries: [1] }],
        },
      },
    })
  const whatsNew = [
    { text: 'Shared.', entries: [1] },
    { text: 'iCloud.', entries: [2] },
  ]

  test('items take their platforms from the entries they cite', () => {
    const notes = parseGenerated('```json\n' + reply(whatsNew) + '\n```', round)
    expect(notes.whatsNew.mobile).toEqual([
      { text: 'Shared.', platforms: both },
      { text: 'iCloud.', platforms: ['ios'] },
    ])
    expect(notes.whatsNew.desktop).toEqual([{ text: 'Finder.', platforms: ['macos'] }])
    expect(notes.testing.mobile?.sinceCandidate).toEqual([{ text: 'b', platforms: ['ios'] }])
    expect(notes.testing.desktop?.sinceRelease).toEqual([{ text: 'd', platforms: ['macos'] }])
  })

  test('an item mixing entries for different platforms is refused', () => {
    expect(() => parseGenerated(reply([{ text: 'Both.', entries: [1, 2] }]), round)).toThrow(
      'mixes entries for different platforms',
    )
  })

  test('a candidate item citing an entry that is not new is refused', () => {
    expect(() => parseGenerated(reply(whatsNew, [{ text: 'old', entries: [1] }]), round)).toThrow(
      'cites 1, which it may not',
    )
  })

  test('an empty candidate list is refused when the changelog has new entries', () => {
    expect(() => parseGenerated(reply(whatsNew, []), round)).toThrow('1 entries are new')
    const unchanged = { ...round, mobile: changes([both, ['ios']], []) }
    expect(parseGenerated(reply(whatsNew, []), unchanged).testing.mobile?.sinceCandidate).toEqual(
      [],
    )
  })

  test("a round without mobile writes only desktop's What's New", () => {
    const notes = parseGenerated(reply(undefined), { desktop: round.desktop })
    expect(notes.whatsNew).toEqual({ desktop: [{ text: 'Finder.', platforms: ['macos'] }] })
    expect(notes.testing.mobile).toBeUndefined()
  })

  test("an app in the round with no What's New items is refused", () => {
    expect(() => parseGenerated(reply([]), round)).toThrow('whatsNew.mobile has no items')
  })

  test("Android What's New items over 500 characters are refused", () => {
    expect(() => parseGenerated(reply([{ text: 'y'.repeat(600), entries: [1] }]), round)).toThrow(
      'over 500',
    )
  })
})
