import { describe, expect, test } from 'bun:test'
import {
  type TestingNotes,
  type WhatsNewEntry,
  candidateChanges,
  changelogSections,
  parseGenerated,
  parseWhatsNew,
  playTestingText,
  readTesting,
  readWhatsNew,
  storeText,
  testFlightText,
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

  test('a candidate after a candidate lists what is new since that candidate', () => {
    const changes = candidateChanges(changelog, '1.16.0-rc.1')
    expect(changes.sinceRelease.from).toBe('1.15.1')
    expect(changes.sinceRelease.entries).toHaveLength(3)
    expect(changes.sinceCandidate).toEqual({
      from: '1.16.0-rc.0',
      entries: [
        'Folders can be shared.',
        'Uploads resume after a crash The upload queue is restored on launch.',
      ],
    })
  })

  test('the first candidate after a stable release has no previous candidate', () => {
    const rest = changelog.slice(changelog.indexOf('## 1.16.0-rc.0'))
    const changes = candidateChanges(rest, '1.16.0-rc.0')
    expect(changes.sinceCandidate).toBeNull()
    expect(changes.sinceRelease).toEqual({ from: '1.15.1', entries: ['Photos import faster.'] })
  })

  test('a changelog whose newest section is another version is refused', () => {
    expect(() => candidateChanges(changelog, '1.16.0-rc.2')).toThrow('1.16.0-rc.1')
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

  test('a candidate version, an unknown platform and an unknown field are refused', () => {
    expect(() => parseWhatsNew([{ ...entry, version: '1.16.0-rc.1' }])).toThrow('plain X.Y.Z')
    expect(() => parseWhatsNew([{ ...entry, items: [{ text: 'x', platforms: ['web'] }] }])).toThrow(
      'platforms',
    )
    expect(() => parseWhatsNew([{ ...entry, note: 'x' }])).toThrow('unknown fields')
  })

  test('the checked-in files are valid', () => {
    expect(readWhatsNew().length).toBeGreaterThan(0)
    expect(() => readTesting()).not.toThrow()
  })
})

const testing: TestingNotes = {
  version: '1.16.0-rc.1',
  sinceCandidate: { from: '1.16.0-rc.0', items: ['Folders can be shared.'] },
  sinceRelease: { from: '1.15.1', items: ['Folders can be shared.', 'Photos import faster.'] },
}

describe('tester notes', () => {
  test('TestFlight gets both lists and the changelog link', () => {
    expect(testFlightText(testing)).toBe(
      [
        'What to test since 1.16.0-rc.0:',
        '- Folders can be shared.',
        '',
        'Everything in 1.16.0 since 1.15.1:',
        '- Folders can be shared.',
        '- Photos import faster.',
        '',
        'Full changelog: https://github.com/SiaFoundation/sia-storage-app/releases/tag/mobile/v1.16.0-rc.1',
      ].join('\n'),
    )
  })

  test('a candidate with no app changes says so', () => {
    const same = { ...testing, sinceCandidate: { from: '1.16.0-rc.0', items: [] } }
    expect(playTestingText(same)).toStartWith(
      'Since 1.16.0-rc.0:\n- No changes to the app since 1.16.0-rc.0.',
    )
  })

  test('Play testing gets the newest list, cut to 500 characters with a pointer to the rest', () => {
    const long: TestingNotes = {
      ...testing,
      sinceCandidate: { from: '1.16.0-rc.0', items: Array(20).fill('x'.repeat(40)) },
    }
    const text = playTestingText(long)
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).toStartWith('Since 1.16.0-rc.0:\n- ')
    expect(text).toContain('- More in the changelog.\n\nhttps://github.com/')
  })
})

describe("the model's reply", () => {
  const reply = (whatsNew: unknown) =>
    JSON.stringify({ whatsNew, sinceCandidate: ['a'], sinceRelease: ['b'] })

  test('a reply wrapped in a code fence is read', () => {
    const notes = parseGenerated('```json\n' + reply(entry.items) + '\n```', 1)
    expect(notes.whatsNew).toEqual(entry.items)
    expect(notes.sinceCandidate).toEqual(['a'])
  })

  test('an empty candidate list is refused when the changelog has new entries', () => {
    const empty = JSON.stringify({ whatsNew: entry.items, sinceCandidate: [], sinceRelease: ['b'] })
    expect(() => parseGenerated(empty, 2)).toThrow('2 entries are new')
    expect(parseGenerated(empty, 0).sinceCandidate).toEqual([])
  })

  test('Android items over 500 characters are refused', () => {
    const long = [{ text: 'y'.repeat(600), platforms: ['ios', 'android'] }]
    expect(() => parseGenerated(reply(long), 1)).toThrow('over 500')
  })

  test('a reply with no item for one platform is refused', () => {
    expect(() =>
      parseGenerated(reply([{ text: 'Only on iPhone.', platforms: ['ios'] }]), 1),
    ).toThrow('no item for android')
  })
})
