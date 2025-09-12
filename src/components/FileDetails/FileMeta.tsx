import { useMemo } from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native'
import { type FileRecord } from '../../db/files'
import { FileStatus } from '../../lib/file'
import { useToast } from '../../lib/toastContext'
import { InfoCard } from '../InfoCard'
import { LabeledValueRow } from '../LabeledValueRow'
import { FileMap } from './FileMap'

export function FileMeta({
  file,
  status,
}: {
  file: FileRecord
  status: FileStatus
}) {
  const toast = useToast()
  const humanSize = useMemo(() => {
    if (file.fileSize == null) return null
    const units = ['B', 'KB', 'MB', 'GB']
    let s = file.fileSize
    let u = 0
    while (s >= 1024 && u < units.length - 1) {
      s /= 1024
      u += 1
    }
    return `${s.toFixed(1)} ${units[u]}`
  }, [file.fileSize])

  const pinnedObjectsList = Object.entries(file.pinnedObjects ?? {})
  return (
    <View style={styles.container}>
      <View style={styles.group}>
        <Text style={styles.groupTitle}>Details</Text>
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
            value={humanSize ?? '—'}
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
        </InfoCard>
      </View>
      {pinnedObjectsList.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pinned Objects</Text>
        </View>
      )}
      {pinnedObjectsList.map(([indexerURL, po]) => (
        <View key={indexerURL} style={styles.group}>
          <Text style={styles.groupTitle}>Pinned Object</Text>
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
              value={JSON.stringify(po.metadata)}
              isMonospace
              showDividerTop
            />
          </InfoCard>
          <Text style={styles.groupSubtitle}>Slabs ({po.slabs.length})</Text>
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
          <InfoCard>
            <FileMap />
          </InfoCard>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#ffffff',
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
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
  group: { marginTop: 18 },
  groupTitle: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 16,
  },
  groupSubtitle: {
    color: '#222',
    marginTop: 16,
    fontWeight: '600',
    marginBottom: 6,
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
