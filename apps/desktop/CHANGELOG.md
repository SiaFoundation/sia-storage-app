## 0.0.1-rc.4 (2026-10-23)

### Features

- The app checks for new versions, downloads them in the background and offers to restart to install. Beta installs update to every new beta and stable release.
- A macOS menu bar app that puts your Sia files in Finder. Browse and open them like any other folder, add and edit files, and see storage, sync and upload progress from the menu bar.
- After signing in, a short tour shows how Sia Storage keeps your files private and where to find them, with setup progress in its corner and a code to scan for the phone app, followed by a list of the setup steps as they finish.
- The window lists your share links under Share links, where each can be copied or revoked.
- Signing in asks for approval in your browser first, then shows a new recovery phrase for a new account or asks for the phrase an existing account already has.
- Opening the app shows your library, uploads and sync in a window, and the menu bar popover and the window share one status line that names what is happening.
- Share files from Finder with Share Link…, which makes a link anyone can open at share.sia.storage that shows either each file's latest version or the files as they are now.

### Fixes

- The app has the Sia Storage icon in Finder, Launchpad and System Settings.
- Opening the app after an update replaces a background service the previous version left running, so the app no longer works against the old version's code until the Mac restarts. A background service started from the command line, or one left by a version from before this release, is restarted only if you agree.
- Uploads and downloads share a memory budget sized from what the device can spare, instead of each taking a tenth of its total memory, and downloads keep part of it however large an upload is. `AppServiceAdapters.readMemory` supplies the reading.
- The window has a Trash view, opened from the status view, that lists deleted files with how long until they are deleted for good, and puts them back or deletes them now.
- Portrait iPhone photos and other rotated HEIC and TIFF images get upright previews when added from the desktop app or the CLI, instead of previews turned on their side.

## 0.0.1-rc.3 (2026-10-13)

### Features

- A macOS menu bar app that puts your Sia files in Finder. Browse and open them like any other folder, add and edit files, and see storage, sync and upload progress from the menu bar.
- After signing in, a short tour shows how Sia Storage keeps your files private and where to find them, with setup progress in its corner and a code to scan for the phone app, followed by a list of the setup steps as they finish.
- The window lists your share links under Share links, where each can be copied or revoked.
- Signing in asks for approval in your browser first, then shows a new recovery phrase for a new account or asks for the phrase an existing account already has.
- Opening the app shows your library, uploads and sync in a window, and the menu bar popover and the window share one status line that names what is happening.
- Share files from Finder with Share Link…, which makes a link anyone can open at share.sia.storage that shows either each file's latest version or the files as they are now.

### Fixes

- The app has the Sia Storage icon in Finder, Launchpad and System Settings.

## 0.0.1-rc.2 (2026-10-13)

### Features

- A macOS menu bar app that puts your Sia files in Finder. Browse and open them like any other folder, add and edit files, and see storage, sync and upload progress from the menu bar.
- After signing in, a short tour shows how Sia Storage keeps your files private and where to find them, with setup progress in its corner and a code to scan for the phone app, followed by a list of the setup steps as they finish.
- The window lists your share links under Share links, where each can be copied or revoked.
- Signing in asks for approval in your browser first, then shows a new recovery phrase for a new account or asks for the phrase an existing account already has.
- Opening the app shows your library, uploads and sync in a window, and the menu bar popover and the window share one status line that names what is happening.
- Share files from Finder with Share Link…, which makes a link anyone can open at share.sia.storage that shows either each file's latest version or the files as they are now.

### Fixes

- The app has the Sia Storage icon in Finder, Launchpad and System Settings.

## 0.0.1-rc.1 (2026-09-29)

### Features

- A macOS menu bar app that puts your Sia files in Finder. Browse and open them like any other folder, add and edit files, and see storage, sync and upload progress from the menu bar.

### Fixes

- The app has the Sia Storage icon in Finder, Launchpad and System Settings.

## 0.0.1-rc.0 (2026-09-21)

### Features

- A macOS menu bar app that puts your Sia files in Finder. Browse and open them like any other folder, add and edit files, and see storage, sync and upload progress from the menu bar.
