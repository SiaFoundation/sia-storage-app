import type { FileRecord } from '@siastorage/core/types'
import { FlatList, StyleSheet, Text } from 'react-native'
import useSWR from 'swr'
import { FileThumbnail } from '../components/FileThumbnail'
import { StatusFileRow } from '../components/StatusFileRow'
import { useNow } from '../hooks/useNow'
import { humanSize } from '../lib/humanSize'
import { relativeTimePhrase } from '../lib/relativeTime'
import { app } from '../stores/appService'
import { type UploadState, useActiveUploads } from '../stores/uploads'
import { colors, palette } from '../styles/colors'

// Live per-file view of the upload queue inside the status sheet. Upload
// entries carry only fileId/size/kind, so rows hydrate name, type, and
// thumbnail from the file records the ids point at. Thumbnails upload too
// but are excluded here, matching every user-facing count; a footer names
// how many are riding along.

function statusLabel(u: UploadState): string {
  if (u.status === 'queued') return 'Queued'
  if (u.status === 'uploading') return `${Math.round(u.progress * 100)}%`
  return 'Encrypting'
}

function statusColor(u: UploadState): string {
  return u.status === 'queued' ? palette.gray[400] : palette.blue[400]
}

function UploadRow({
  upload,
  record,
  now,
  first,
}: {
  upload: UploadState
  record: FileRecord | undefined
  now: number
  first: boolean
}) {
  // Added-then-size leads because the tail is what an ellipsis eats; a long
  // mime type may clip, the timestamp and size never should.
  const detail = [
    record ? `added ${relativeTimePhrase(record.addedAt, now)}` : null,
    humanSize(upload.size),
    record?.type,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <StatusFileRow
      thumbnail={record ? <FileThumbnail file={record} thumbSize={64} /> : null}
      name={record?.name ?? upload.name ?? 'File'}
      detail={detail}
      trailing={
        <Text style={[styles.status, { color: statusColor(upload) }]}>{statusLabel(upload)}</Text>
      }
      first={first}
    />
  )
}

export function UploadsScreen() {
  const now = useNow()
  const uploads = useActiveUploads()
  const files = uploads.filter((u) => u.kind !== 'thumb')
  const thumbCount = uploads.length - files.length
  const ids = files.map((u) => u.id)
  const { data: records } = useSWR(
    ids.length > 0 ? ['uploads-view-files', ids.join(',')] : null,
    () => app().files.getByIds(ids),
  )
  const recordById = new Map((records ?? []).map((r) => [r.id, r]))
  // Working files first (they have visible motion), then the queue.
  const ordered = [
    ...files.filter((u) => u.status !== 'queued'),
    ...files.filter((u) => u.status === 'queued'),
  ]
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={ordered}
      keyExtractor={(u) => u.id}
      renderItem={({ item, index }) => (
        <UploadRow upload={item} record={recordById.get(item.id)} now={now} first={index === 0} />
      )}
      ListEmptyComponent={<Text style={styles.empty}>No active uploads.</Text>}
      ListFooterComponent={
        thumbCount > 0 ? (
          <Text style={styles.footer}>
            {thumbCount === 1 ? '1 thumbnail' : `${thumbCount.toLocaleString()} thumbnails`} also
            uploading.
          </Text>
        ) : null
      }
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  content: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    color: palette.gray[400],
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 32,
  },
  footer: {
    color: palette.gray[500],
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
})
