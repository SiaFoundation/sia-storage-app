import { describe, expect, test } from 'bun:test'
import {
  headerLine,
  mobileCandidateHeader,
  mobileFinalHeader,
  renderHeader,
  withHeader,
} from '../../../scripts/release-header'
import {
  changesetTrain,
  isStale,
  nextCandidate,
  parseCandidateTag,
  releaseBranch,
  shipped,
  wasShipped,
} from '../../../scripts/release-trains'

describe('release trains', () => {
  test('a changeset belongs to the train of its packages', () => {
    expect(changesetTrain(['mobile'])).toMatchObject({ name: 'mobile' })
    expect(changesetTrain(['core', 'cli'])).toMatchObject({ name: 'packages' })
  })

  test('a changeset naming packages of two trains is refused', () => {
    expect(changesetTrain(['mobile', 'core'])).toBe(
      'names packages of the mobile and packages trains, which release separately. Write one changeset for each',
    )
  })

  test('release branches name their train and whether they are a final', () => {
    expect(releaseBranch('release/mobile')).toMatchObject({
      train: { name: 'mobile' },
      final: false,
    })
    expect(releaseBranch('release/desktop-final')).toMatchObject({
      train: { name: 'desktop' },
      final: true,
    })
    expect(releaseBranch('release/packages-final')).toBeNull()
    expect(releaseBranch('release')).toBeNull()
    expect(releaseBranch('feature/release')).toBeNull()
  })

  test('only a mobile or desktop candidate tag parses', () => {
    expect(parseCandidateTag('mobile/v1.15.1-rc.3\n')).toEqual({
      app: 'mobile',
      version: '1.15.1-rc.3',
    })
    expect(parseCandidateTag('mobile/v1.15.1')).toBeNull()
    expect(parseCandidateTag('cli/v0.0.8-rc.3')).toBeNull()
    expect(parseCandidateTag('mobile/v1.15.1-rc.3; rm -rf /')).toBeNull()
  })

  test('a candidate cut during review keeps the version and takes the next number', () => {
    expect(nextCandidate('1.15.1', ['1.15.1-rc.3', '1.15.1-rc.1', '1.15.0-rc.9'])).toBe(
      '1.15.1-rc.4',
    )
    expect(nextCandidate('1.16.0', ['1.15.1-rc.3'])).toBe('1.16.0-rc.0')
  })

  test('a changeset went out in a candidate when its file or its text did', () => {
    const by = shipped(
      new Map([['split-change.md', ['mobile', 'desktop', 'cli']]]),
      '## 0.0.2-rc.3 (2026-11-20)\n\n### Fixes\n\n- Renamed files keep their\n  thumbnails.\n',
      '0.0.2-rc.3',
    )
    const desktopHalf = { file: 'split-change-desktop.md', packages: ['desktop'], text: 'x' }
    expect(wasShipped({ ...desktopHalf, file: 'split-change.md' }, 'desktop', by)).toBe(true)
    expect(
      wasShipped({ ...desktopHalf, text: 'Renamed files keep their thumbnails.' }, 'desktop', by),
    ).toBe(true)
    expect(wasShipped(desktopHalf, 'desktop', by)).toBe(false)
  })

  test('a release PR is rebuilt only when main changed a file it depends on', () => {
    const watched = ['apps/mobile/package.json', '.changeset/fix.md']
    expect(isStale(['apps/desktop/src/main.ts', 'packages/core/src/a.ts'], watched)).toBe(false)
    expect(isStale(['apps/desktop/src/main.ts', 'apps/mobile/package.json'], watched)).toBe(true)
    expect(isStale(['.changeset/fix.md'], watched)).toBe(true)
  })
})

describe('release PR headers', () => {
  test('a header shows the steps with the current one in bold', () => {
    const header = renderHeader(mobileCandidateHeader('1.15.1-rc.4', null))
    expect(header).toContain('**Mobile 1.15.1-rc.4**')
    expect(header).toContain('**Candidate** › Testing › Review › Released')
    expect(header).toContain('Merging sends rc.4 to TestFlight and Google Play internal testing.')
  })

  test("Store Review's App Store line replaces the old one and keeps the rest of the body", () => {
    const final = (appStore: string) =>
      renderHeader(
        mobileFinalHeader({
          version: '1.15.1',
          candidate: '1.15.1-rc.3',
          buildNumber: '1150103',
          appStore,
          googlePlay: 'Google Play: In review',
        }),
      )
    const body = `${final('App Store: Waiting for review')}\n\n## What's New in 1.15.1\n`
    const updated = withHeader(body, final('App Store: Approved'))
    expect(headerLine(updated, 'App Store:')).toBe('App Store: Approved')
    expect(updated).toEndWith("## What's New in 1.15.1\n")
    expect(updated.match(/release-status -->/g)).toHaveLength(2)
  })

  test('a body without a header gets one on top', () => {
    expect(withHeader('notes', 'HEADER')).toBe('HEADER\n\nnotes')
  })
})
