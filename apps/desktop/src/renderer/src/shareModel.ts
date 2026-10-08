/*
 * How the share view lays a link's files out under their folders. Kept apart
 * from the view so it can be tested without rendering it.
 */

/** Files under the folder each is in, folders in the order their first file came. */
export function groupByFolder<T extends { folder: string | null }>(
  files: T[],
): Array<{ folder: string | null; files: T[] }> {
  const groups = new Map<string | null, T[]>()
  for (const file of files) {
    const group = groups.get(file.folder)
    if (group) group.push(file)
    else groups.set(file.folder, [file])
  }
  return [...groups].map(([folder, grouped]) => ({ folder, files: grouped }))
}

/** A folder named by its own name, as Finder lists it. Null is the top of the library. */
export function folderName(folder: string | null, libraryName: string): string {
  return folder ? (folder.split('/').pop() ?? folder) : libraryName
}
