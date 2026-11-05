## 0.0.2-rc.1 (2026-11-05)

### Features

- `sia config set cacheMaxBytes` and `sia config set cacheMinAge` change how much the local cache may hold and how long a file must go unused before it can be removed, and the status window shows how much is cached against the limit.
- The files cached on this computer are kept under 4 GB by removing backed-up files that have not been used for a day, and they download again when opened.
- The status window has Clear Local Files, which removes this Mac's copies of files that are already backed up and keeps the rest.
- Sia Storage opens when you log in, so the Finder folder and syncing are back after a restart without opening the app. It is turned on the first time the app has an account, and the Open at login switch in the status window turns it off.
- The menu bar popover has an Activity tab listing the files added most recently and whether each is uploaded yet, with buttons to show a file in Finder or copy a share link to it in one click, using link settings you can change beside the button.
- Finder shows each photo and video's own thumbnail in the Sia Storage folder, including files that are not downloaded to the Mac.

### Fixes

- A deleted folder no longer stays behind empty or comes back on your other devices. It goes to the trash as one item, and restoring it, or a file trashed from it earlier, puts the files back in the folders they came from, creating them again if needed. Trashing the last file in a folder removes the folder too, except in the Finder folder on the Mac, which keeps it until you delete it.
- The app's window is dark in dark mode and white in light mode, like other Mac windows, instead of a washed-out gray that made everything in it harder to read.
- Restart installs a downloaded update and reopens the app, instead of sometimes doing nothing. If the install fails, the app says so and Restart can be tried again.
- The app no longer asks you to sign in again when its background service is still starting or busy, such as right after an update, and a window opened before the service answers shows your library once it does.
- The background sync process shows as "Sia Storage Sync" in Activity Monitor instead of "bun".
- An update waiting for a restart no longer goes stale: the app keeps checking for releases and downloads a newer one in the background, so one restart installs the newest version.
- A file's local copy is no longer removed to save space, and Finder no longer treats it as backed up, until the file is on the indexer you use now, so switching indexers cannot leave a file with no copy the new indexer can get.
- Opening a file from Finder no longer fails when the cache removes its copy at the same moment, and a download is never cut short by cache cleanup. `fs.removeFile` takes `skipIfLocked` and resolves whether it removed the file.
- Share Link lists the files being shared, and the files on a link once it is made, by folder and then by name, in the same order on every device.
- Putting a file in the trash, on its own or by deleting its folder, takes it off your share links, and restoring it no longer shares it again.

## 0.0.2-rc.0 (2026-11-04)

### Features

- `sia config set cacheMaxBytes` and `sia config set cacheMinAge` change how much the local cache may hold and how long a file must go unused before it can be removed, and the status window shows how much is cached against the limit.
- The files cached on this computer are kept under 4 GB by removing backed-up files that have not been used for a day, and they download again when opened.
- The status window has Clear Local Files, which removes this Mac's copies of files that are already backed up and keeps the rest.
- The menu bar popover has an Activity tab listing the files added most recently and whether each is uploaded yet, with buttons to show a file in Finder or copy a share link to it in one click, using link settings you can change beside the button.
- Finder shows each photo and video's own thumbnail in the Sia Storage folder, including files that are not downloaded to the Mac.

### Fixes

- A deleted folder no longer stays behind empty or comes back on your other devices. It goes to the trash as one item, and restoring it, or a file trashed from it earlier, puts the files back in the folders they came from, creating them again if needed. Trashing the last file in a folder removes the folder too, except in the Finder folder on the Mac, which keeps it until you delete it.
- The app's window is dark in dark mode and white in light mode, like other Mac windows, instead of a washed-out gray that made everything in it harder to read.
- Restart installs a downloaded update and reopens the app, instead of sometimes doing nothing. If the install fails, the app says so and Restart can be tried again.
- A file's local copy is no longer removed to save space, and Finder no longer treats it as backed up, until the file is on the indexer you use now, so switching indexers cannot leave a file with no copy the new indexer can get.
- Opening a file from Finder no longer fails when the cache removes its copy at the same moment, and a download is never cut short by cache cleanup. `fs.removeFile` takes `skipIfLocked` and resolves whether it removed the file.
- Share Link lists the files being shared, and the files on a link once it is made, by folder and then by name, in the same order on every device.
- Putting a file in the trash, on its own or by deleting its folder, takes it off your share links, and restoring it no longer shares it again.

## 0.0.1 (2026-10-30)

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
- Opening the disk image shows the app beside your Applications folder, with an arrow between them and a line that says to drag it there.
- Opening the app after an update replaces a background service the previous version left running, so the app no longer works against the old version's code until the Mac restarts. A background service started from the command line, or one left by a version from before this release, is restarted only if you agree.
- Uploads and downloads share a memory budget sized from what the device can spare, instead of each taking a tenth of its total memory, and downloads keep part of it however large an upload is. `AppServiceAdapters.readMemory` supplies the reading.
- The window has a Trash view, opened from the status view, that lists deleted files with how long until they are deleted for good, and puts them back or deletes them now.
- Portrait iPhone photos and other rotated HEIC and TIFF images get upright previews when added from the desktop app or the CLI, instead of previews turned on their side.

## 0.0.1-rc.6 (2026-10-29)

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
- Opening the disk image shows the app beside your Applications folder, with an arrow between them and a line that says to drag it there.
- Opening the app after an update replaces a background service the previous version left running, so the app no longer works against the old version's code until the Mac restarts. A background service started from the command line, or one left by a version from before this release, is restarted only if you agree.
- Uploads and downloads share a memory budget sized from what the device can spare, instead of each taking a tenth of its total memory, and downloads keep part of it however large an upload is. `AppServiceAdapters.readMemory` supplies the reading.
- The window has a Trash view, opened from the status view, that lists deleted files with how long until they are deleted for good, and puts them back or deletes them now.
- Portrait iPhone photos and other rotated HEIC and TIFF images get upright previews when added from the desktop app or the CLI, instead of previews turned on their side.

## 0.0.1-rc.5 (2026-10-28)

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
- Opening the disk image shows the app beside your Applications folder, with an arrow between them and a line that says to drag it there.
- Opening the app after an update replaces a background service the previous version left running, so the app no longer works against the old version's code until the Mac restarts. A background service started from the command line, or one left by a version from before this release, is restarted only if you agree.
- Uploads and downloads share a memory budget sized from what the device can spare, instead of each taking a tenth of its total memory, and downloads keep part of it however large an upload is. `AppServiceAdapters.readMemory` supplies the reading.
- The window has a Trash view, opened from the status view, that lists deleted files with how long until they are deleted for good, and puts them back or deletes them now.
- Portrait iPhone photos and other rotated HEIC and TIFF images get upright previews when added from the desktop app or the CLI, instead of previews turned on their side.

## 0.0.1-rc.4 (2026-10-26)

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
