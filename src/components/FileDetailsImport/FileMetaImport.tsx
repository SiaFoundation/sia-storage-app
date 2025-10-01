import { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { type FileStatus } from '../../lib/file'
import { InfoCard } from '../InfoCard'
import { LabeledValueRow } from '../LabeledValueRow'
import { RowGroup } from '../Group'
import { useShowAdvanced } from '../../stores/settings'

export function FileMetaImport({
  file,
  status,
}: {
  file: {
    id: string
    fileName: string | null
    fileSize: number | null
    fileType: string | null
  }
  status: FileStatus
}) {
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

  const showAdvanced = useShowAdvanced()

  return (
    <View style={styles.container}>
      <RowGroup title="Details">
        <InfoCard>
          <LabeledValueRow
            label="Size"
            value={humanSize ?? '—'}
            showDividerTop
          />
          <LabeledValueRow
            label="Type"
            value={file.fileType ?? '—'}
            showDividerTop
          />
          {showAdvanced.data && status.cachedUri && (
            <LabeledValueRow
              label="Cached URL"
              value={status.cachedUri}
              showDividerTop
            />
          )}
        </InfoCard>
      </RowGroup>
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
