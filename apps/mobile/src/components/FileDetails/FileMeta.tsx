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
import { colors, palette } from '../../styles/colors'
import { BulkManageTagsSheet } from '../BulkManageTagsSheet'
import { RowGroup } from '../Group'
import { InfoCard } from '../InfoCard'
import { InputRow } from '../InputRow'
import { LabeledValueRow } from '../LabeledValueRow'
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
      <RowGroup title="Details">
        <InfoCard>
          <InputRow label="Name" placeholder="Untitled file" {...fileNameInputProps} />
          {showAdvanced.data && (
            <LabeledValueRow label="ID" value={file.id} isMonospace showDividerTop />
          )}
          {showAdvanced.data && (
            <LabeledValueRow
              label="Local ID"
              value={file.localId ?? '-'}
              isMonospace
              ellipsizeMode="middle"
              canCopy={!!file.localId}
              showDividerTop
            />
          )}
          {showAdvanced.data && (
            <LabeledValueRow
              label="Content Hash"
              value={file.hash ?? '-'}
              isMonospace
              ellipsizeMode="middle"
              canCopy={!!file.hash}
              showDividerTop
            />
          )}
          {showAdvanced.data && (
            <LabeledValueRow
              label="File URI"
              value={status.fileUri ?? 'Not available'}
              isMonospace
              ellipsizeMode="middle"
              canCopy={!!status.fileUri}
              showDividerTop
            />
          )}
          <LabeledValueRow label="Size" value={fileSize ?? '—'} showDividerTop />
          <LabeledValueRow
            label="Created"
            value={new Date(file.createdAt).toLocaleString()}
            showDividerTop
          />
          <LabeledValueRow
            label="Updated"
            value={new Date(file.updatedAt).toLocaleString()}
            showDividerTop
          />
          <LabeledValueRow label="Type" value={file.type ?? '—'} showDividerTop />
        </InfoCard>
      </RowGroup>
      <RowGroup title="Tags">
        <InfoCard>
          <View style={styles.tagsSection}>
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
              <Text style={styles.addTagText}>Add Tag</Text>
            </Pressable>
          </View>
        </InfoCard>
      </RowGroup>
      <BulkManageTagsSheet sheetName={tagSheetName} fileIds={[file.id]} />
      <RowGroup title="File shard storage locations">
        <InfoCard>
          <View style={{ height: Math.round(windowHeight * 0.5) }}>
            <FileMap fileId={file.id} />
          </View>
        </InfoCard>
      </RowGroup>
      {showAdvanced.data && (
        <>
          {thumbnails.data?.length ? (
            <RowGroup title="Thumbnails">
              <InfoCard>
                {thumbnails.data.map(({ record, uri }, index) => {
                  const thumbSizeLabel = record.thumbSize ? `${record.thumbSize}px` : 'Unknown'
                  const label = `Thumbnail ${thumbSizeLabel} URI`
                  const value = uri ?? 'Not cached'
                  return (
                    <LabeledValueRow
                      key={record.id}
                      labelWidth={200}
                      label={label}
                      value={value}
                      isMonospace
                      align="left"
                      ellipsizeMode="middle"
                      numberOfLines={1}
                      showDividerTop={index > 0}
                      canCopy={!!uri}
                    />
                  )
                })}
              </InfoCard>
            </RowGroup>
          ) : null}
          {pinnedObjects.data && pinnedObjects.data.length > 1 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pinned Objects</Text>
            </View>
          )}
          {pinnedObjects.data?.map(({ indexerURL, pinnedObject }) => (
            <Fragment key={indexerURL}>
              <RowGroup title="Pinned Object">
                <InfoCard>
                  <LabeledValueRow label="Indexer URL" value={indexerURL} isMonospace />
                  <LabeledValueRow
                    label="Created"
                    value={new Date(pinnedObject.createdAt()).toLocaleString()}
                    showDividerTop
                  />
                  <LabeledValueRow
                    label="Updated"
                    value={new Date(pinnedObject.updatedAt()).toLocaleString()}
                    showDividerTop
                  />
                  <LabeledValueRow
                    label="ID"
                    value={pinnedObject.id()}
                    isMonospace
                    showDividerTop
                  />
                  <LabeledValueRow
                    label="Slabs"
                    value={String(pinnedObject.slabs().length)}
                    isMonospace
                    showDividerTop
                  />
                  <LabeledValueRow
                    label="Metadata"
                    value={JSON.stringify(decodeFileMetadata(pinnedObject.metadata()), null, 2)}
                    numberOfLines={10}
                    isMonospace
                    align="left"
                    showDividerTop
                  />
                </InfoCard>
              </RowGroup>
            </Fragment>
          ))}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: palette.gray[950],
  },
  section: { marginTop: 30, marginBottom: 6 },
  sectionTitle: {
    color: palette.gray[400],
    fontWeight: '700',
    fontSize: 18,
  },
  groupCard: {
    marginTop: 8,
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tagsSection: {
    padding: 12,
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
})
