# Roadmap

A high-level view of where Sia Storage is headed. Day-to-day work is tracked in the [issue tracker](https://github.com/SiaFoundation/sia-storage-app/issues).

## Stability and performance

- Eliminate crashes and lifecycle bugs around backgrounding, suspend, and app reset ([#550](https://github.com/SiaFoundation/sia-storage-app/issues/550), [#547](https://github.com/SiaFoundation/sia-storage-app/issues/547)).
- Fix layout across device sizes ([#548](https://github.com/SiaFoundation/sia-storage-app/issues/548), [#546](https://github.com/SiaFoundation/sia-storage-app/issues/546)).
- Prioritize downloads and thumbnails by viewport visibility ([#539](https://github.com/SiaFoundation/sia-storage-app/issues/539), [#231](https://github.com/SiaFoundation/sia-storage-app/issues/231)).
- Catch performance regressions in CI ([#549](https://github.com/SiaFoundation/sia-storage-app/issues/549)).

## Onboarding and first-launch

- Polish onboarding — copy, returning-user path, and first-launch bug fixes ([#528](https://github.com/SiaFoundation/sia-storage-app/issues/528), [#529](https://github.com/SiaFoundation/sia-storage-app/issues/529), [#530](https://github.com/SiaFoundation/sia-storage-app/issues/530), [#551](https://github.com/SiaFoundation/sia-storage-app/issues/551)).
- Polish the cleanup messaging shown during app startup ([#543](https://github.com/SiaFoundation/sia-storage-app/issues/543)).

## Settings and account

- Redesign settings and profile — sign-out, resync, and fewer, clearer controls ([#544](https://github.com/SiaFoundation/sia-storage-app/issues/544), [#545](https://github.com/SiaFoundation/sia-storage-app/issues/545)).
- Simplify the host map shown in settings and file details ([#554](https://github.com/SiaFoundation/sia-storage-app/issues/554)).

## File viewer

- Polish the viewer — controls, detail discoverability, and navigation ([#532](https://github.com/SiaFoundation/sia-storage-app/issues/532), [#533](https://github.com/SiaFoundation/sia-storage-app/issues/533), [#534](https://github.com/SiaFoundation/sia-storage-app/issues/534)).
- Handle edge cases for failed uploads and importing media ([#535](https://github.com/SiaFoundation/sia-storage-app/issues/535), [#536](https://github.com/SiaFoundation/sia-storage-app/issues/536)).
- Video streaming on iOS and Android ([#51](https://github.com/SiaFoundation/sia-storage-app/issues/51), [#52](https://github.com/SiaFoundation/sia-storage-app/issues/52)).

## File library

- Faster bulk workflows — drag-to-select and bulk tag removal ([#537](https://github.com/SiaFoundation/sia-storage-app/issues/537), [#542](https://github.com/SiaFoundation/sia-storage-app/issues/542)).
- Explain what file status icons mean and count importing files in stats ([#538](https://github.com/SiaFoundation/sia-storage-app/issues/538), [#541](https://github.com/SiaFoundation/sia-storage-app/issues/541)).

## Platform expansion

- Ship the CLI for macOS, Linux, and Windows.
- Ship the desktop app for macOS, Linux, and Windows.
- Ship the web app.

## Distribution

- Publish the Android app to F-Droid ([#569](https://github.com/SiaFoundation/sia-storage-app/issues/569)).
