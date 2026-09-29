/**
 * The library snapshot every device kind returns. Mobile, desktop and the CLI
 * share one schema, so one query describes all of them.
 */
import type { LibraryEntry } from './types'

export const LIBRARY_QUERY = `
SELECT f.id, f.name, f.hash, f.size, d.path AS dir, f.current,
       f.trashedAt IS NOT NULL AS trashed,
       (SELECT json_group_array(t.name) FROM file_tags ft JOIN tags t ON t.id = ft.tagId
          WHERE ft.fileId = f.id) AS tags,
       EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id) AS uploaded
FROM files f LEFT JOIN directories d ON d.id = f.directoryId
WHERE f.kind = 'file' AND f.deletedAt IS NULL
ORDER BY f.id`

type LibraryRow = Omit<LibraryEntry, 'current' | 'trashed' | 'uploaded' | 'tags'> & {
  /** A JSON array, since a tag name can hold a comma. */
  tags: string
  current: number
  trashed: number
  uploaded: number
}

export function toLibrary(rows: LibraryRow[]): LibraryEntry[] {
  return rows.map((r) => ({
    ...r,
    // Sorted here rather than in the query, since SQLite does not promise
    // json_group_array keeps a subquery's order.
    tags: (JSON.parse(r.tags) as string[]).sort(),
    current: r.current === 1,
    trashed: r.trashed === 1,
    uploaded: r.uploaded === 1,
  }))
}
