# Feature map

Every feature of the apps: what it is, where its code lives, how to reach it on
each platform, what state shows it worked, and which tests already cover it.
Read a feature's entry before changing it, and update the entry in the same diff
when the feature moves.

A `sim` block is a recipe: paste its lines to reach the place and leave it
again, from the library screen a signed-in phone opens on. `{file}`, `{folder}`
and `{tag}` stand for a file, folder and tag you have. The mobile navigation
scenario runs every recipe on iOS and Android, so a recipe that works there
works for you.

A test in `apps/sim/test` fails when a name here no longer exists: an AppService
group, a screen, a `sia` command, a table, a core service, a file, a scenario or
an integration test. It also fails when a scenario is missing from the map. It
also fails when a recipe taps a label or test id that no longer exists in the
mobile app's source.

## Features

### Files and versions

- When: adding, opening, renaming, moving, trashing, restoring and deleting
  files, and the versions kept under one name.
- Code: `app.files`; screens `Library`, `Directory`, `UnavailableFiles`; CLI
  `add`, `mv`, `rm`, `ls`
- Check: tables `files`, `objects`; `bun sim library`
- Tests: scenarios `mobile/rename-in-viewer`, `sync/edits-propagate`,
  `sync/delete-stays-deleted`, `sync/offline-conflict`,
  `sync/offline-edits-survive-kill`, `sync/same-name-on-three-devices`,
  `sync/edits-during-own-upload`, `mobile/phone-and-laptop`; integration
  `trash-restore`, `version-sync`, `full-lifecycle`, `bulk-operations`
- CLI: `bun sim sia laptop -- ls`,
  `bun sim sia laptop -- mv {file} renamed.bin`,
  `bun sim call laptop files.renameFile <id> renamed.bin`
- Desktop: the Finder folder, `bun sim device finder mac`, then `ls`, `mv`, `rm`
  in it.
- Phone, open a file and its actions:

```sim
bun sim device tap phone --label Files
bun sim device tap phone --contains "No folder"
bun sim device tap phone --contains {file}
bun sim device tap phone --label "More actions"
bun sim device expect phone --text "Move to trash"
bun sim device tap phone --label "Close sheet"
bun sim device expect phone --text "Move to trash" --gone
bun sim device tap phone --label Close
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

- Phone, rename a file from its details. A tap on Rename while the keyboard is
  up only closes the keyboard, so the recipe taps the sheet's title first:

```sim
bun sim device tap phone --label Files
bun sim device tap phone --contains "No folder"
bun sim device tap phone --contains {file}
bun sim device tap phone --label "Toggle file details"
bun sim device tap phone --contains "Name, "
bun sim device type phone --label "File name" "renamed-{file}"
bun sim device tap phone --text "Rename File"
bun sim device tap phone --text Rename
bun sim device expect phone --text "Rename File" --gone
bun sim device expect phone --contains "renamed-"
bun sim device tap phone --label "Toggle file details"
bun sim device tap phone --label Close
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

### Folders

- When: creating, renaming and deleting folders, and moving files into them.
- Code: `app.directories`; screens `Directory`; CLI `mkdir`, `mv`
- Check: tables `directories`, `files`
- Tests: scenarios `sync/folder-rename-vs-offline-edit`,
  `sync/move-to-root-and-untag`; integration `directory-cascade`
- CLI: `bun sim sia laptop -- mkdir {folder}`,
  `bun sim sia laptop -- mv {file} {folder}/`
- Phone, create a folder and open it:

```sim
bun sim device tap phone --label Files
bun sim device tap phone --label "Create folder"
bun sim device type phone --label "Folder name" "{folder}"
bun sim device tap phone --text Create
bun sim device expect phone --label "Folder name" --gone
bun sim device expect phone --text "{folder}"
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

- Phone, move a file into a new folder:

```sim
bun sim device tap phone --label Files
bun sim device tap phone --contains "No folder"
bun sim device tap phone --contains {file}
bun sim device tap phone --label "Move to folder"
bun sim device type phone --label "Search or create folder" "{folder}"
bun sim device tap phone --contains "Create \"{folder}\""
bun sim device tap phone --label Close
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

### Tags and Favorites

- When: tagging files, the Favorites system tag, and browsing by tag.
- Code: `app.tags`; screens `TagLibrary`; CLI `tags`
- Check: tables `tags`, `file_tags`
- Tests: scenarios `sync/move-to-root-and-untag`,
  `sync/unfavorite-reaches-peer`; integration `tag-rename`, `multi-device-sync`
- CLI: `bun sim sia laptop -- tags`
- Phone, create a tag:

```sim
bun sim device tap phone --label Tags
bun sim device tap phone --label "Create tag"
bun sim device type phone --label "Tag name" "{tag}"
bun sim device tap phone --text Create
bun sim device expect phone --label "Tag name" --gone
bun sim device expect phone --contains "{tag}"
bun sim device tap phone --label Media
bun sim device expect phone --label Menu
```

- Phone, tag a file and favorite it:

```sim
bun sim device tap phone --label Files
bun sim device tap phone --contains "No folder"
bun sim device tap phone --contains {file}
bun sim device tap phone --label Favorite
bun sim device expect phone --label Unfavorite
bun sim device tap phone --label Unfavorite
bun sim device tap phone --label "Add tag"
bun sim device type phone --label "Search or create tag" "{tag}"
bun sim device tap phone --contains "Create \"{tag}\""
bun sim device tap phone --text Done
bun sim device tap phone --label Close
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

### Search

- When: finding files by name and by tag.
- Code: screens `Search`; CLI `search`
- Tests: integration `search`
- CLI: `bun sim sia laptop -- search {file}`
- Phone:

```sim
bun sim device tap phone --label Search
bun sim device type phone --label "Search files" "{file}" --submit
bun sim device expect phone --contains {file}
bun sim device tap phone --label "Close search"
bun sim device expect phone --label Menu
```

### Library views and selection

- When: sorting, filtering and switching gallery or list, and selecting many
  files to act on together.
- Code: screens `Library`, `Directory`, `TagLibrary`, `Search`
- Tests: scenarios `mobile/navigation`
- Phone, view settings:

```sim
bun sim device tap phone --label Media
bun sim device tap phone --label "View settings"
bun sim device expect phone --text "Date Added"
bun sim device tap phone --label "Close menu"
bun sim device expect phone --text "Date Added" --gone
```

- Phone, selection mode:

```sim
bun sim device tap phone --label Media
bun sim device tap phone --label "Enter selection mode"
bun sim device expect phone --text "Select items"
bun sim device tap phone --label "Exit selection mode"
bun sim device expect phone --label Menu
```

### Uploads

- When: packing files into objects, retrying failed uploads, and what the
  Uploads list shows.
- Code: `app.uploader`, `app.uploads`; services `uploader`; screens `Uploads`
- Check: tables `objects`; `bun sim net objects`, `bun sim converge`
- Tests: scenarios `resilience/failed-adds`, `resilience/kill-mid-upload`,
  `resilience/offline-backlog`, `resilience/upload-failures-retry`,
  `mobile/failed-adds-on-phone`, `mobile/kill-mid-upload`; integration
  `upload-packing`, `partial-batch-errors`, `sequential-batches-complete`,
  `files-stuck-after-batch`
- Phone, the status sheet and the Uploads list:

```sim
bun sim device tap phone --label Status
bun sim device tap phone --text Uploads
bun sim device back phone
bun sim device tap phone --text Done
bun sim device expect phone --label Menu
```

### Downloads and the local cache

- When: a file's bytes coming down to a device, download priority, and freeing
  local copies.
- Code: `app.downloads`, `app.fs`; services `cacheEviction`; CLI `download`
- Check: `call <device> downloads.getState`; tables `fs`
- Tests: scenarios `mobile/clear-local-files-keeps-unuploaded`,
  `sync/converge-and-download`, `mobile/tapped-download-arrives`; integration
  `downloads`, `fs-eviction`, `fs-adopt`, `fs-orphan`, `size-reconcile`
- CLI: `bun sim sia laptop -- download {file}`
- Desktop: `bun sim device download mac {file}` downloads a cloud-only file by
  reading it through Finder, and `bun sim device finder-state mac {file}` shows
  whether it is downloaded. Nothing in sim can evict a download: macOS answers
  that request only from the app itself.

### File types

- When: a file's stored MIME type, its name and extension on every device, and
  which types get thumbnails.
- Code: services `thumbnailScanner`; files
  `packages/core/src/lib/detectMimeType.ts`,
  `packages/core/src/lib/fileTypes.ts`
- Check:
  `bun sim sql <device> "SELECT name, type FROM files WHERE kind = 'file'"`
- Tests: scenarios `sync/file-types`, `sync/file-names-with-hash`,
  `sync/property-named-extensions`, `sync/raw-photo-types`,
  `sync/raw-photo-repair`, `sync/canon-raw-type`,
  `sync/type-change-keeps-local-copy`, `sync/unicode-names`,
  `mobile/file-types`, `mobile/raw-photo-keeps-type`, `desktop/file-types`,
  `desktop/finder-save-types`, `desktop/finder-save-unicode-names`; integration
  `thumbnail-generation`
- CLI: `bun sim seed laptop --type all` adds ten real files of every type, named
  in every shape that has broken before. `--type image`, `--type png` or
  `--type application/pdf` narrow it, and `-n` sets the count per type.

### Sync

- When: metadata pushed up, events pulled down, conflicts and convergence.
- Code: `app.sync`; services `syncUpMetadata`, `syncDownEvents`; CLI `sync`
- Check: tables `feed_meta`; `bun sim converge`, `bun sim logs`
- Tests: scenarios `resilience/kills-during-catch-up`,
  `resilience/thousand-files`, `mobile/suspend-during-sync-down`; integration
  `sync-down`, `sync-down-abort`, `sync-up-metadata`,
  `multi-device-convergence`, `feed-convergence`, `change-events`

### Imports

- When: the Files picker, the camera, shares and the photo library bringing
  files in.
- Code: `app.imports`; services `importScanner`; screens `Imports`,
  `ImportDetail`, `ImportFile`; CLI `import`
- Check: tables `imports`, `import_files`
- Tests: scenarios `mobile/mixed-import`, `mobile/kill-mid-import`,
  `mobile/import-after-resume`, `mobile/suspend-during-large-import`,
  `mobile/import-finalize-during-suspend`, `mobile/ui-add-files-sheet`,
  `photos/new-photos`, `photos/photo-library`; integration `imports`
- Phone, the Add files sheet:

```sim
bun sim device tap phone --label Media
bun sim device tap phone --label "Add files"
bun sim device expect phone --id action-import-from-files
bun sim device tap phone --label "Close sheet"
bun sim device expect phone --id action-import-from-files --gone
```

- Phone, the imports list:

```sim
bun sim device tap phone --label Status
bun sim device tap phone --text Imports
bun sim device back phone
bun sim device tap phone --text Done
bun sim device expect phone --label Menu
```

### Thumbnails

- When: the small images the library shows for photos and videos.
- Code: `app.thumbnails`; services `thumbnailScanner`
- Check:
  `bun sim sql <device> "SELECT thumbForId, thumbSize FROM files WHERE kind = 'thumb'"`
- Tests: scenarios `sync/file-types`, `sync/thumbnails-by-type`,
  `mobile/file-types`; integration `thumbnail-generation`, `thumbnail-scanner`

### Finder on the Mac

- When: the desktop app's Finder folder, and the File Provider extension that
  serves it from the daemon.
- Code: `app.provider`, served to the extension by
  `apps/cli/src/daemon/ipc/provider.ts`
- Check: on a CLI device, stage bytes with `stage()` or `handoffTarget()`, then
  `call` its `provider.*` methods.
- Tests: scenarios `desktop/finder-opens-peer-files`,
  `desktop/finder-save-reaches-peer`,
  `desktop/finder-rename-and-delete-reach-peer`, `desktop/file-types`,
  `desktop/finder-save-types`, `desktop/finder-save-unicode-names`,
  `finder/concurrent-opens`, `finder/stale-base-save`,
  `finder/edit-against-remote-trash`, `finder/offline-edit-not-stranded`,
  `finder/rename-and-edit-elsewhere`, `finder/same-name-create`,
  `finder/save-survives-restart`; integration `provider-handoff`,
  `provider-reads`, `provider-changes`, `provider-bulk-create`,
  `provider-write-integrity`
- Desktop: `bun sim device finder mac` prints the folder, and `cp`, `mv`, `rm`
  and reading a file in it take the path Finder takes. `finder-state` shows what
  Finder shows for a file, `download` reads a cloud-only file through Finder,
  and `show` opens the folder in Finder. Only desktop devices run the Swift
  extension, Finder and macOS's File Provider framework.

### The desktop app's windows

- When: the tray icon's status popover, the sign-in window, the More menu and
  the sign-out dialogs.
- Code: files `apps/desktop/src/main/tray.ts`,
  `apps/desktop/src/renderer/src/Status.tsx`,
  `apps/desktop/src/renderer/src/SignIn.tsx`, `apps/desktop/src/main/menu.ts`
- Desktop, the status popover and its More menu:

```sh
bun sim device tray mac
bun sim device expect mac --text "Open Folder"
bun sim device tap mac --label More
bun sim device expect mac --text "Open Logs"
bun sim device ui mac
```

`device ui mac` lists both windows' elements and any open native menu or
dialog. A desktop device is signed in before the app starts, so the sign-in
window shows only after Sign Out.

### Phone lifecycle

- When: suspension, kills and switching apps on a phone.
- Code: services `suspension`
- Check: `bun sim device background`, `device kill`, `device locks` (iOS)
- Tests: scenarios `mobile/suspend-mid-upload`,
  `mobile/suspend-during-finalize`, `mobile/sign-in-during-statement`,
  `mobile/rapid-app-switching`, `mobile/database-uses-wal`,
  `mobile/import-resumes-after-suspension`; integration `suspension`, `app-boot`

### Account and onboarding

- When: signing in, the recovery phrase, switching indexer and resetting.
- Code: `app.auth`; screens `OnboardingWelcome`, `OnboardingRecoveryPhrase`,
  `OnboardingAdvancedIndexer`, `SwitchIndexer`, `SwitchRecoveryPhrase`,
  `SwitchFinished`; CLI `connect`, `reset`
- Tests: none drive the sign-in screens. Sim phones sign in through test mode.
- Phone, the Switch indexer screens:

```sim
bun sim device tap phone --label Menu
bun sim device scroll-to phone --text "Switch indexers"
bun sim device tap phone --text "Switch indexers"
bun sim device expect phone --id indexer-option-default
bun sim device tap phone --label Close
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

### Sharing

- When: share links to a file.
- Code: `app.shares`
- Tests: none.

### Settings and logs

- When: the menu's settings, the developer screen and the logs viewer.
- Code: `app.settings`, `app.logs`; screens `Menu`, `SettingsAdvanced`,
  `SettingsLogs`; CLI `config`, `logs`
- Check: tables `logs`; `bun sim logs <device>`
- Tests: integration `settings-persistence`
- Phone, the developer screen and the logs:

```sim
bun sim device tap phone --label Menu
bun sim device scroll-to phone --label Developers
bun sim device tap phone --label Developers
bun sim device scroll-to phone --label "View logs"
bun sim device tap phone --label "View logs"
bun sim device expect phone --label "Log level"
bun sim device back phone
bun sim device back phone
bun sim device tap phone --label Back
bun sim device expect phone --label Menu
```

### Slab pruning

- When: freeing network storage the library no longer uses.
- Code: services `pruneSlabs`
- Tests: integration `prune-slabs`

## Screens

How to reach and leave every phone screen and sheet, from the library.

- Library: the home screen. Tabs `Media`, `Files` and `Tags`, and header buttons
  `Menu`, `Status`, `View settings` and `Enter selection mode`.
- Directory: Files tab, a folder's name or `No folder`. Leave with `Back`.
- Tag library: Tags tab, a tag's name. Leave with `Back`.
- Search: `Search`. Leave with `Close search`.
- File viewer: a file's cell, labelled with its name. `More actions` opens its
  actions, `Toggle file details` its details, `Move to folder` and `Add tag`
  their sheets. Leave with `Close`.
- Action sheets (Add files, a file's actions): `Close sheet`, the backdrop, or a
  swipe down on one of their rows.
- Modal sheets (rename, new folder, new tag, move, tags): their header button,
  `Cancel` or `Done`.
- Status sheet: `Status`. Rows `Imports`, `Uploads`, and `Unavailable` when
  there are some. Leave with `Done`.
- Menu: `Menu`. Rows include `Import folder`, `Imports`, `Switch indexers` and
  `Developers`. Leave with `Back`.
- Developers: Menu, `Developers`. `View logs` opens the logs viewer.
- Switch indexer: Menu, `Switch indexers`. Leave with `Close`.
