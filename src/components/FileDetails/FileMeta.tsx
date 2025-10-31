import { Fragment, useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, palette } from '../../styles/colors'
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
              value={file.contentHash ?? '-'}
              isMonospace
              ellipsizeMode="middle"
              canCopy={!!file.contentHash}
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
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: palette.gray[950],
  },
  verticalSmallGap: {
    gap: 10,
  },
  photoFileName: {
    color: colors.textTitleDark,
    marginBottom: 6,
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
