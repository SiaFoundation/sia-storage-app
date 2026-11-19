# Writing Sia Storage release notes

Prepare Release gives this guide to the model that writes `whats-new.json` and `testing.json`
for each release candidate of the mobile and desktop apps. People editing either file follow it
too.

## What's New (`whats-new.json`)

The list a user reads in the App Store, on Google Play and in the app's own What's New
screen. One entry per version, for everything since the last stable release. It is written
for the person using the app, who is not technical.

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
- **Mark platforms.** An item that only applies to one platform lists only that platform:
  iCloud and the Photos picker are iOS, storage permissions and the system navigation bar are
  Android, VoiceOver is iOS and TalkBack is Android. Never mention the other platform in an
  item.
- **Never list file formats.** "Support for many more audio, video, and image formats."
- **Google Play allows 500 characters.** The Android items, one per line with "- " in front,
  must fit in 500. Shorten every item before dropping one. The App Store allows 4000.
- **Nothing about testing.** No release candidate numbers, no "since rc.2", no TestFlight.
  This text ships inside the app.

The 1.15.0 entry is an example of the length and tone.

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
Each app in the round gets its own lists, from its own changelog.

- **Since the last candidate:** two to four items on what changed since the previous
  candidate, such as the fix for a problem found in it. Left out for the first candidate after
  a stable release.
- **Since the last release:** everything in the version so far, grouped by theme, one item per
  theme.
- **Mark platforms.** Each item lists the platforms a tester can try it on, from that app's
  platforms only. Mark an item for one platform when it names that platform's own things, such
  as iCloud on iOS, Finder on macOS or File Explorer on Windows, and otherwise for all of them.
- **One sentence per item, friendly and not technical.** For a pile of related fixes, say
  "Fixed some issues with importing files". No function, table or library names.
- **Never list file formats**, and leave out dependency updates, refactors and build changes.
