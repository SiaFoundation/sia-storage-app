import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { useShowAdvanced, useTagsForFile } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { PencilIcon, PlusIcon } from 'lucide-react-native'
import { Fragment, useCallback, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import useSWR from 'swr'
import { usePinnedObjects } from '../../hooks/usePinnedObjects'
import type { FileStatus } from '../../lib/file'
import { humanSize } from '../../lib/humanSize'
import { app } from '../../stores/appService'
import { openSheet } from '../../stores/sheets'
import { palette } from '../../styles/colors'
import { BulkManageTagsSheet } from '../BulkManageTagsSheet'
import { InsetGroupCopyRow, InsetGroupSection, InsetGroupValueRow } from '../InsetGroup'
import { RenameSheet } from '../RenameSheet'
import { TagPill } from '../TagPill'
import { FileMap } from './FileMap'

export function FileMeta({ file, status }: { file: FileRecord; status: FileStatus }) {
  const showAdvanced = useShowAdvanced()
  const fileSize = useMemo(() => {
    if (file.size === 0) return null
    return humanSize(file.size)
  }, [file.size])

  const renameSheetName = `renameFile-${file.id}`

  const handleRenameFile = useCallback(
    async (newName: string) => {
      await app().files.update({ id: file.id, name: newName })
    },
    [file.id],
  )
  const pinnedObjects = usePinnedObjects(file.id)
  const thumbnails = useSWR(
    showAdvanced.data ? app().caches.thumbnails.byFileId.key(file.id) : null,
    async () => {
      const records = await app().thumbnails.getForFile(file.id)
      return Promise.all(
        records.map(async (thumb) => ({
          record: thumb,
          uri: await app().fs.getFileUri(thumb),
        })),
      )
    },
  )
  const { height: windowHeight } = useWindowDimensions()
  const { data: allFileTags } = useTagsForFile(file.id)
  const userTags = allFileTags?.filter((t) => !t.system)
  const tagSheetName = `manageTags-${file.id}`
  return (
    <View style={styles.container}>
      <InsetGroupSection
        header="Tags"
        headerRight={
          <Pressable onPress={() => openSheet(tagSheetName)} hitSlop={8}>
            <PlusIcon size={16} color={palette.blue[400]} />
          </Pressable>
        }
      >
        <View style={styles.tagsRow}>
          {userTags && userTags.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagsContainer}
            >
              {userTags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  onRemove={() => app().tags.remove(file.id, tag.id)}
                />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.noTagsText}>No tags</Text>
          )}
        </View>
      </InsetGroupSection>
      <BulkManageTagsSheet sheetName={tagSheetName} fileIds={[file.id]} />

      <InsetGroupSection header="Details">
        <Pressable style={styles.nameRow} onPress={() => openSheet(renameSheetName)}>
          <Text numberOfLines={1} style={styles.nameLabel}>
            Name
          </Text>
          <Text numberOfLines={1} style={styles.nameText}>
            {file.name || 'Untitled file'}
          </Text>
          <PencilIcon size={14} color={palette.gray[400]} />
        </Pressable>
        <InsetGroupValueRow label="Size" value={fileSize ?? '—'} />
        <InsetGroupValueRow label="Type" value={file.type ?? '—'} />
        <InsetGroupValueRow label="Created" value={new Date(file.createdAt).toLocaleString()} />
        <InsetGroupValueRow label="Updated" value={new Date(file.updatedAt).toLocaleString()} />
      </InsetGroupSection>
      <RenameSheet
        sheetName={renameSheetName}
        title="Rename File"
        placeholder="File name"
        initialValue={file.name ?? ''}
        onRename={handleRenameFile}
      />

      {showAdvanced.data ? (
        <InsetGroupSection header="Identity">
          <InsetGroupCopyRow label="ID" value={file.id} />
          {file.mediaAssetId ? (
            <InsetGroupCopyRow label="Media Asset ID" value={file.mediaAssetId} />
          ) : null}
          {file.hash ? <InsetGroupCopyRow label="Content hash" value={file.hash} /> : null}
          {status.fileUri ? <InsetGroupCopyRow label="File URI" value={status.fileUri} /> : null}
        </InsetGroupSection>
      ) : null}

      <InsetGroupSection header="Storage locations">
        <View style={{ height: Math.round(windowHeight * 0.5) }}>
          <FileMap fileId={file.id} />
        </View>
      </InsetGroupSection>

      {showAdvanced.data && thumbnails.data?.length ? (
        <InsetGroupSection header="Thumbnails">
          {thumbnails.data.map(({ record, uri }) => {
            const label = `${record.thumbSize ? `${record.thumbSize}px` : 'Unknown'} URI`
            return uri ? (
              <InsetGroupCopyRow key={record.id} label={label} value={uri} />
            ) : (
              <InsetGroupValueRow key={record.id} label={label} value="Not cached" />
            )
          })}
        </InsetGroupSection>
      ) : null}

      {showAdvanced.data && pinnedObjects.data
        ? pinnedObjects.data.map(({ indexerURL, pinnedObject }) => (
            <Fragment key={indexerURL}>
              <InsetGroupSection header="Pinned object" footer={indexerURL}>
                <InsetGroupCopyRow label="ID" value={pinnedObject.id()} />
                <InsetGroupValueRow
                  label="Created"
                  value={new Date(pinnedObject.createdAt()).toLocaleString()}
                />
                <InsetGroupValueRow
                  label="Updated"
                  value={new Date(pinnedObject.updatedAt()).toLocaleString()}
                />
                <InsetGroupValueRow label="Slabs" value={String(pinnedObject.slabs().length)} />
              </InsetGroupSection>
              <InsetGroupSection header="Pinned metadata">
                <View style={styles.metadataBlock}>
                  <Text style={styles.metadataText} numberOfLines={20}>
                    {JSON.stringify(decodeFileMetadata(pinnedObject.metadata()), null, 2)}
                  </Text>
                </View>
              </InsetGroupSection>
            </Fragment>
          ))
        : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: palette.gray[950],
  },
  tagsRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  tagsContainer: {
    gap: 8,
    flexDirection: 'row',
  },
  noTagsText: {
    color: palette.gray[400],
    fontSize: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
    paddingVertical: 11,
    gap: 8,
  },
  nameLabel: {
    color: palette.gray[100],
    fontSize: 16,
    marginRight: 4,
  },
  nameText: {
    flex: 1,
    color: palette.gray[400],
    fontSize: 15,
    textAlign: 'right',
  },
  metadataBlock: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  metadataText: {
    color: palette.gray[100],
    fontFamily: 'Menlo',
    fontSize: 12,
  },
})
