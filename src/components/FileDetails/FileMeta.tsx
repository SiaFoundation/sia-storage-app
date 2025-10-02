import { Fragment, useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { updateFileRecord, type FileRecord } from '../../stores/files'
import { FileStatus } from '../../lib/file'
import { InfoCard } from '../InfoCard'
import { LabeledValueRow } from '../LabeledValueRow'
import { RowGroup, RowSubGroup } from '../Group'
import { humanSize } from '../../lib/humanSize'
import { decodeFileMetadata } from '../../encoding/fileMetadata'
import { useShowAdvanced } from '../../stores/settings'
import { InputRow } from '../InputRow'
import { useInputValue } from '../../hooks/useInputValue'
import { usePinnedObjects } from '../../hooks/usePinnedObjects'

export function FileMeta({
  file,
  status,
}: {
  file: FileRecord
  status: FileStatus
}) {
  const showAdvanced = useShowAdvanced()
  const fileSize = useMemo(() => {
    return humanSize(file.fileSize)
  }, [file.fileSize])

  const fileNameInputProps = useInputValue({
    value: file.fileName ?? '',
    save: (value) => {
      updateFileRecord({ ...file, fileName: value })
    },
  })
  const pinnedObjects = usePinnedObjects(file)
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
            <LabeledValueRow label="ID" value={file.id} isMonospace />
          )}
          {showAdvanced.data && (
            <LabeledValueRow
              label="Cached URL"
              value={status.cachedUri ?? 'Not available'}
              isMonospace
              ellipsizeMode="middle"
              canCopy={!!status.cachedUri}
              showDividerTop
            />
          )}
          <LabeledValueRow
            label="Size"
            value={fileSize ?? '—'}
            showDividerTop={showAdvanced.data}
          />
          <LabeledValueRow
            label="Created"
            value={new Date(file.createdAt).toLocaleString()}
            showDividerTop
          />
          <LabeledValueRow
            label="Type"
            value={file.fileType ?? '—'}
            showDividerTop
          />
        </InfoCard>
      </RowGroup>
      {showAdvanced.data && (
        <>
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
              <View style={styles.verticalSmallGap}>
                <RowSubGroup title={`Slabs (${pinnedObject.slabs().length})`}>
                  <InfoCard>
                    {pinnedObject.slabs().map((s, i) => (
                      <LabeledValueRow
                        key={s.id}
                        label="Slab"
                        value={s.id}
                        isMonospace
                        showDividerTop={i > 0}
                      />
                    ))}
                  </InfoCard>
                </RowSubGroup>
              </View>
            </Fragment>
          ))}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
    backgroundColor: '#f2f2f7',
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  verticalSmallGap: {
    gap: 10,
  },
  photoFileName: {
    color: '#111827',
    marginBottom: 6,
  },
  section: { marginTop: 30, marginBottom: 6 },
  sectionTitle: {
    color: '#aaa',
    fontWeight: '700',
    fontSize: 18,
  },
  groupCard: {
    marginTop: 8,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
