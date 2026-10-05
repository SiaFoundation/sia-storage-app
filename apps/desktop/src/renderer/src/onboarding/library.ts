/*
 * The library the Finder and phone mocks both show. One list for the two, so
 * the same folders and files appear in each, which is what they are there to
 * say about the real ones.
 */

export type MockFolder = { name: string; files: number; folders: number; modified: string }

export type MockFile = {
  name: string
  /** As Finder's Kind column words it. */
  kind: string
  size: string
  modified: string
  /** Whether its bytes are on this Mac, or still to be downloaded when it is opened. */
  downloaded: boolean
}

export const FOLDERS: MockFolder[] = [
  { name: 'Documents', files: 12, folders: 0, modified: 'Today at 9:12 AM' },
  { name: 'Photos', files: 248, folders: 3, modified: 'Yesterday at 6:40 PM' },
  { name: 'Trips', files: 36, folders: 0, modified: 'Yesterday at 2:05 PM' },
]

/** Files at the top level. The phone lists these together as "No folder". */
export const FILES: MockFile[] = [
  {
    name: 'Birthday.mov',
    kind: 'QuickTime movie',
    size: '412 MB',
    modified: 'Today at 8:31 AM',
    downloaded: false,
  },
  {
    name: 'Budget.xlsx',
    kind: 'Spreadsheet',
    size: '88 KB',
    modified: 'Today at 9:02 AM',
    downloaded: true,
  },
  {
    name: 'Lease 2026.pdf',
    kind: 'PDF document',
    size: '340 KB',
    modified: 'Yesterday at 11:17 AM',
    downloaded: false,
  },
  {
    name: 'Passport.jpg',
    kind: 'JPEG image',
    size: '2.1 MB',
    modified: 'Yesterday at 10:48 AM',
    downloaded: false,
  },
]
