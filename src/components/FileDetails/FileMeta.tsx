import { Fragment, useMemo } from 'react'
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native'
import { colors, palette } from '../../styles/colors'
import { updateFileRecord, type FileRecord } from '../../stores/files'
import { FileStatus } from '../../lib/file'
import { InfoCard } from '../InfoCard'
import { LabeledValueRow } from '../LabeledValueRow'
import { RowGroup } from '../Group'
import { humanSize } from '../../lib/humanSize'
import { decodeFileMetadata } from '../../encoding/fileMetadata'
import { useShowAdvanced } from '../../stores/settings'
import { InputRow } from '../InputRow'
import { useInputValue } from '../../hooks/useInputValue'
import { usePinnedObjects } from '../../hooks/usePinnedObjects'
import useSWR from 'swr'
import { readThumbnailsByHash, thumbnailSwr } from '../../stores/thumbnails'
import { getFsFileUri } from '../../stores/fs'
import { FileMap } from './FileMap'

export function FileMeta({
  file,
  status,
}: {
  file: FileRecord
  status: FileStatus
}) {
  const showAdvanced = useShowAdvanced()
  const fileSize = useMemo(() => {
    return humanSize(file.size)
  }, [file.size])

  const fileNameInputProps = useInputValue({
    value: file.name ?? '',
    save: (value) => {
      updateFileRecord({ id: file.id, name: value })
    },
  })
  const pinnedObjects = usePinnedObjects(file)
  const thumbnails = useSWR(
    showAdvanced.data ? thumbnailSwr.getKey(`${file.hash}/all`) : null,
    async () => {
      const records = await readThumbnailsByHash(file.hash)
      return Promise.all(
        records.map(async (thumb) => ({
          record: thumb,
          uri: await getFsFileUri(thumb),
        }))
      )
    }
  )
  const { height: windowHeight } = useWindowDimensions()
  return (
    <View style={styles.container}>
      <RowGroup title="Details">
        <InfoCard>
          <InputRow
            label="Name"
            placeholder="Untitled file"
            {...fileNameInputProps}
          />
          {showAdvanced.data && (
            <LabeledValueRow
              label="ID"
              value={file.id}
              isMonospace
              showDividerTop
            />
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
          <LabeledValueRow
            label="Size"
            value={fileSize ?? '—'}
            showDividerTop
          />
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
          <LabeledValueRow
            label="Type"
            value={file.type ?? '—'}
            showDividerTop
          />
        </InfoCard>
      </RowGroup>
      <RowGroup title="File shard storage locations">
        <InfoCard>
          <View style={{ height: Math.round(windowHeight * 0.5) }}>
            <FileMap file={file} />
          </View>
        </InfoCard>
      </RowGroup>
      {showAdvanced.data && (
        <>
          {thumbnails.data?.length ? (
            <RowGroup title="Thumbnails">
              <InfoCard>
                {thumbnails.data.map(({ record, uri }, index) => {
                  const thumbSizeLabel = record.thumbSize
                    ? `${record.thumbSize}px`
                    : 'Unknown'
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
                  <LabeledValueRow
                    label="Indexer URL"
                    value={indexerURL}
                    isMonospace
                  />
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
                    value={pinnedObject.slabs().length}
                    isMonospace
                    showDividerTop
                  />
                  <LabeledValueRow
                    label="Metadata"
                    value={JSON.stringify(
                      decodeFileMetadata(pinnedObject.metadata()),
                      null,
                      2
                    )}
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
})
