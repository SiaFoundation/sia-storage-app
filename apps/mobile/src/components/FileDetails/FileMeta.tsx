import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { useShowAdvanced, useTagsForFile } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { PlusIcon } from 'lucide-react-native'
import { Fragment, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import useSWR from 'swr'
import { useInputValue } from '../../hooks/useInputValue'
import { usePinnedObjects } from '../../hooks/usePinnedObjects'
import type { FileStatus } from '../../lib/file'
import { humanSize } from '../../lib/humanSize'
import { app } from '../../stores/appService'
import { openSheet } from '../../stores/sheets'
import { palette } from '../../styles/colors'
import { BulkManageTagsSheet } from '../BulkManageTagsSheet'
import {
  InsetGroupCopyRow,
  InsetGroupInputRow,
  InsetGroupSection,
  InsetGroupValueRow,
} from '../InsetGroup'
import { TagPill } from '../TagPill'
import { FileMap } from './FileMap'

export function FileMeta({ file, status }: { file: FileRecord; status: FileStatus }) {
  const showAdvanced = useShowAdvanced()
  const fileSize = useMemo(() => {
    if (file.size === 0) return null
    return humanSize(file.size)
  }, [file.size])

  const fileNameInputProps = useInputValue({
    value: file.name ?? '',
    save: (value) => {
      app().files.update({ id: file.id, name: value })
    },
  })
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
      <InsetGroupSection header="Details">
        <InsetGroupInputRow label="Name" placeholder="Untitled file" {...fileNameInputProps} />
        <InsetGroupValueRow label="Size" value={fileSize ?? '—'} />
        <InsetGroupValueRow label="Type" value={file.type ?? '—'} />
        <InsetGroupValueRow label="Created" value={new Date(file.createdAt).toLocaleString()} />
        <InsetGroupValueRow label="Updated" value={new Date(file.updatedAt).toLocaleString()} />
      </InsetGroupSection>

      {showAdvanced.data ? (
        <InsetGroupSection header="Identity">
          <InsetGroupCopyRow label="ID" value={file.id} />
          {file.localId ? <InsetGroupCopyRow label="Local ID" value={file.localId} /> : null}
          {file.hash ? <InsetGroupCopyRow label="Content hash" value={file.hash} /> : null}
          {status.fileUri ? <InsetGroupCopyRow label="File URI" value={status.fileUri} /> : null}
        </InsetGroupSection>
      ) : null}

      <InsetGroupSection header="Tags">
        <View style={styles.tagsRow}>
          {userTags && userTags.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagsContainer}
            >
              {userTags.map((tag) => (
                <TagPill key={tag.id} tag={tag} />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.noTagsText}>No tags</Text>
          )}
          <Pressable style={styles.addTagButton} onPress={() => openSheet(tagSheetName)}>
            <PlusIcon size={14} color={palette.blue[400]} />
            <Text style={styles.addTagText}>Add tag</Text>
          </Pressable>
        </View>
      </InsetGroupSection>
      <BulkManageTagsSheet sheetName={tagSheetName} fileIds={[file.id]} />

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
  addTagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  addTagText: {
    color: palette.blue[400],
    fontSize: 14,
    fontWeight: '500',
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
