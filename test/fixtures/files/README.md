# File-type test corpus

One `sample.<ext>` file per MIME in `packages/core/src/lib/fileTypes.ts`.
`packages/core/src/lib/fileTypeFixtures.test.ts` walks this directory and
asserts every file resolves correctly through both the extension lookup and
the magic-byte detector, driven by `expectations.ts`.

## Adding a new fixture

1. Drop the file in this directory as `sample.<ext>`.
2. Add a matching entry to `expectations.ts` with `mime`, `bytesMime`, and
   `source`. The test enforces that the directory and the map stay in sync.

## Where files came from

The `source` field on each expectation records provenance:

- `small` — [github.com/mathiasbynens/small](https://github.com/mathiasbynens/small)
  — the smallest syntactically valid file per format. CC0.
- `format-corpus` — [github.com/openpreserve/format-corpus](https://github.com/openpreserve/format-corpus)
  — the Open Preservation Foundation's curated corpus, used here for Office,
  iWork, OpenDocument, ebooks, and a real `.mov`. CC0.
- `generated` — synthesized via `ffmpeg`, `sips`, or a native CLI archiver.
  Real format-compliant bytes, written for this project; placed in the public
  domain.
- `stub` — a hand-written magic-byte prefix. Passes MIME detection but isn't
  a real openable file. Replace with a real sample when convenient (no test
  change needed if the new file's magic-byte detection result is unchanged).

## Stubs worth replacing with real samples

- Camera RAW (CR2/CR3/NEF/NRW/ARW/RAF/ORF/RW2/PEF) and DNG — sources at
  [rawpedia.rawtherapee.com/Sample_Files](https://rawpedia.rawtherapee.com/Sample_Files).
- HEIC sequence (`.heics`), AVCI / AVCS — export from an iPhone Live Photo.
- iWork (`.numbers`, `.key`) — create in Numbers / Keynote and export.
- OOXML (`.xlsx`, `.pptx`) — any one-page LibreOffice export.
- Installers (DMG, MSI, DEB, RPM, APK, PKG, AppImage, snap, flatpak) — grab
  one from F-Droid (APK), a Linux distro mirror (DEB/RPM), or any open-source
  release page.
