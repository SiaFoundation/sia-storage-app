import { Fragment, useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { type FileRecord } from '../../db/files'
import { FileStatus } from '../../lib/file'
import { InfoCard } from '../InfoCard'
import { LabeledValueRow } from '../LabeledValueRow'
import { arrayBufferToHex } from '../../lib/hex'
import { RowGroup, RowSubGroup } from '../Group'
import { humanSize } from '../../functions/humanSize'

export function FileMeta({
  file,
  status,
}: {
  file: FileRecord
  status: FileStatus
}) {
  const fileSize = useMemo(() => {
    return humanSize(file.fileSize)
  }, [file.fileSize])

  const pinnedObjectsList = Object.entries(file.pinnedObjects ?? {})
  return (
    <View style={styles.container}>
      <RowGroup title="Details">
        <InfoCard>
          <LabeledValueRow
            label="ID"
            value={file.id}
            isMonospace
            numberOfLines={1}
          />
          <LabeledValueRow
            label="Cached URL"
            value={status.cachedUri ?? 'Not available'}
            isMonospace
            numberOfLines={1}
            ellipsizeMode="middle"
            canCopy={!!status.cachedUri}
            showDividerTop
          />
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
            label="Type"
            value={file.fileType ?? '—'}
            showDividerTop
          />
          <LabeledValueRow
            label="Encryption Key"
            value={file.encryptionKey}
            isMonospace
            showDividerTop
          />
        </InfoCard>
      </RowGroup>
      {pinnedObjectsList.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pinned Objects</Text>
        </View>
      )}
      {pinnedObjectsList.map(([indexerURL, po]) => (
        <Fragment key={indexerURL}>
          <RowGroup title="Pinned Object">
            <InfoCard>
              <LabeledValueRow
                label="Indexer URL"
                value={indexerURL}
                isMonospace
                numberOfLines={1}
              />
              <LabeledValueRow
                label="Created"
                value={new Date(po.createdAt).toLocaleString()}
              />
              <LabeledValueRow
                label="Updated"
                value={new Date(po.updatedAt).toLocaleString()}
                showDividerTop
              />
              <LabeledValueRow
                label="Key"
                value={po.key}
                isMonospace
                numberOfLines={1}
                showDividerTop
              />
              <LabeledValueRow
                label="Metadata"
                value={arrayBufferToHex(po.metadata)}
                isMonospace
                showDividerTop
              />
            </InfoCard>
          </RowGroup>
          <View style={styles.verticalSmallGap}>
            <RowSubGroup title={`Slabs (${po.slabs.length})`}>
              <InfoCard>
                {po.slabs.map((s, i) => (
                  <LabeledValueRow
                    key={s.id}
                    label="Slab"
                    value={s.id}
                    isMonospace
                    numberOfLines={1}
                    showDividerTop={i > 0}
                  />
                ))}
              </InfoCard>
            </RowSubGroup>
            {/* <InfoCard>
              <FileMap />
            </InfoCard> */}
          </View>
        </Fragment>
      ))}
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
