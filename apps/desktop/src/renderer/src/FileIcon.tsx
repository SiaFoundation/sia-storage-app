/*
 * A file's icon in a list, as Finder draws it with icon previews on: a photo
 * or video shows its own thumbnail, and every other file, or a photo whose
 * thumbnail has not synced yet, shows the icon macOS uses for its type.
 */

import { useApp } from '@siastorage/core/app'
import { useOnLibraryListChange } from '@siastorage/core/stores'
import { reloadList } from '@siastorage/core/stores/library'
import { useState } from 'react'
import useSWR from 'swr'
import { fileExtension } from './activityModel'
import { sia } from './api'
import { FinderItemIcon } from './finderIcons'

/** 64px is the smaller of the two thumbnails the library keeps, and covers a 32pt slot at 2x. */
const THUMB_SIZE = 64

export function FileIcon({ id, name, type }: { id: string; name: string; type: string }) {
  const app = useApp()
  const previewable = type.startsWith('image/') || type.startsWith('video/')
  // The key is the cache this Mac invalidates when it makes a thumbnail. A
  // thumbnail another device made arrives by sync, which invalidates no
  // thumbnail cache, so a row still without one, or whose download failed,
  // asks again on each library change, one read at a time per row, since a
  // read can wait on a download while sync keeps changing the library.
  const thumbQuery = useSWR(
    previewable ? app.caches.thumbnails.best.key(id, String(THUMB_SIZE)) : null,
    async () => {
      const image = await app.thumbnails.read(id, THUMB_SIZE)
      return image ? `data:${image.mimeType};base64,${image.data}` : null
    },
    { revalidateOnFocus: false },
  )
  useOnLibraryListChange((version) => {
    if (previewable && !thumbQuery.data) {
      reloadList(app, `thumbnail/${id}/${THUMB_SIZE}`, version, () => thumbQuery.mutate())
    }
  })
  const thumb = thumbQuery.data
  const extension = fileExtension(name)
  const typeIcon = useSWR(['type-icon', extension], () => sia.typeIcon(extension), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  }).data
  // A thumbnail the browser cannot decode, such as a format another device
  // wrote that Chromium has no codec for, falls back to the type icon.
  const [broken, setBroken] = useState<string | null>(null)

  if (thumb && broken !== thumb) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center">
        <img
          src={thumb}
          alt=""
          draggable={false}
          className="size-7 rounded-[4px] object-cover outline-1 -outline-offset-1 outline-black/10"
          onError={() => setBroken(thumb)}
        />
      </span>
    )
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center">
      {typeIcon ? (
        <img src={typeIcon} alt="" draggable={false} className="size-8" />
      ) : (
        <FinderItemIcon folder={false} size={24} />
      )}
    </span>
  )
}
