# Writing Sia Storage release notes

Prepare Release gives this guide to the model that writes `whats-new.json` and `testing.json`
for each release candidate of the mobile and desktop apps. People editing either file follow it
too.

## What's New (`whats-new.json`)

The list a user reads about a new version: for mobile in the App Store, on Google Play and in
the app's What's New screen, and for desktop in the desktop app. Each app has its own file in
its `release-notes` folder, with one entry per version, for everything since that app's last
stable release. It is written for the person using the app, who is not technical.

- **One short item, usually one sentence.** No lists inside an item, no parentheticals.
- **4 to 6 items.** Group related changes under one item. Lead with the biggest wins for the
  user, not the order things merged.
- **Describe what improved, never "fixed an issue with".** "Faster, more reliable file
  imports", not "Fixed some issues with importing files".
- **No technical words.** Never: background, backgrounding, race, scanner, viewer, cache,
  eviction, indexer, sync engine, handled gracefully, behind the scenes, filename extension,
  edge case, recovery options, or any function, table or library name. If an item needs one
  of these, it is at the wrong level. Say what the person notices. A setting's name as the
  app shows it, such as Upload in the background, is fine.
- **No causes or edge cases.** Drop clauses such as "even when the name is wrong" or "after
  the app is suspended".
- **Only what a person can notice.** Internal speed or memory work is an item only when it
  shows as something visible, such as faster previews.
- **Keep platforms apart.** Each item's platforms come from the changelog entries it cites,
  and an entry marked [only ios] applies to iOS alone. Never combine entries for different
  platforms in one item, and never mention the other platform in an item. A store with
  nothing new in a version shows "Bug fixes and performance improvements." on its own.
- **Never list file formats.** "Support for many more audio, video, and image formats."
- **Google Play allows 500 characters.** Mobile's Android items, one per line with "- " in front,
  must fit in 500. Shorten every item before dropping one. The App Store allows 4000.
- **Nothing about testing.** No release candidate numbers, no "since rc.2", no TestFlight.
  This text ships inside the app.

The 1.15.0 entry is an example of the length and tone.

## Platforms in a changeset

A changeset for a change that reaches only some of an app's platforms names them, so the notes
keep it to those platforms:

```
---
desktop: patch
platforms: macos
---
```

The platforms are `ios` and `android` for `mobile`, and `macos`, `windows` and `linux` for
`desktop`, separated by commas. A changeset without the line applies to every platform of its
apps. Knope skips the line, and `bun run check-changesets` checks it.

| Release candidate wording                                                                   | What's New wording                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Fixed some issues with importing files.                                                     | Faster, more reliable file imports.                     |
| Interrupting an upload or download by backgrounding the app no longer displays as an error. | Uploads and downloads stop and resume more reliably.    |
| Files are identified by their content, and mismatched types get corrected.                  | Smarter file type detection and better preview support. |
| Photo archive sync no longer re-imports photos already in your library.                     | Smoother photo backup that avoids duplicate imports.    |
| Redesigned initialization error screen with clearer recovery options.                       | Improved startup error screen.                          |

## Tester notes (`testing.json`)

What people testing a release candidate read: TestFlight and Google Play internal testing for
the mobile app, and the beta desktop app. They know the app well and want to know what to try.
Each app has its own `testing.json` in its `release-notes` folder, written from its own changelog.

- **Since the last candidate:** two to four items on what changed since the previous
  candidate, such as the fix for a problem found in it. A feature the previous candidate
  already had, whose changeset was reworded, gets an item on what changed in it, not one
  presenting it as new. Left out for the first candidate after a stable release.
- **Since the last release:** everything in the version so far, grouped by theme, one item per
  theme.
- **Keep platforms apart.** As in What's New, an item's platforms come from the entries it
  cites, so never combine entries for different platforms in one item.
- **One sentence per item, friendly and not technical.** For a pile of related fixes, say
  "Fixed some issues with importing files". No function, table or library names.
- **Never list file formats**, and leave out dependency updates, refactors and build changes.
