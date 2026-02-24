import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { FileStatus } from '../../lib/file'
import type { FileRecord } from '../../stores/files'
import { useShowAdvanced } from '../../stores/settings'
import { colors } from '../../styles/colors'
import { RowGroup } from '../Group'
import { InfoCard } from '../InfoCard'
import { LabeledValueRow } from '../LabeledValueRow'

export function FileMetaImport({
  file,
  status,
}: {
  file: FileRecord
  status: FileStatus
}) {
  const humanSize = useMemo(() => {
    if (file.size == null) return null
    const units = ['B', 'KB', 'MB', 'GB']
    let s = file.size
    let u = 0
    while (s >= 1024 && u < units.length - 1) {
      s /= 1024
      u += 1
    }
    return `${s.toFixed(1)} ${units[u]}`
  }, [file.size])

  const showAdvanced = useShowAdvanced()

  const hasValidSize = file.size > 0
  const hasValidType = file.type && file.type !== 'application/octet-stream'
  const hasValidHash = !!file.hash

  return (
    <View style={styles.container}>
      <RowGroup title="Details">
        <InfoCard>
          {showAdvanced.data && <LabeledValueRow label="ID" value={file.id} />}
          <LabeledValueRow
            label="Size"
            value={
              hasValidSize ? (
                (humanSize ?? '—')
              ) : (
                <View style={styles.unknownValue}>
                  <Text style={styles.unknownText}>unknown</Text>
                  <View style={styles.requiredIndicator} />
                </View>
              )
            }
          />
          <LabeledValueRow
            label="Type"
            value={
              hasValidType ? (
                file.type
              ) : (
                <View style={styles.unknownValue}>
                  <Text style={styles.unknownText}>unknown</Text>
                  <View style={styles.requiredIndicator} />
                </View>
              )
            }
            showDividerTop
          />
          <LabeledValueRow
            label="Hash"
            value={
              hasValidHash ? (
                file.hash
              ) : (
                <View style={styles.unknownValue}>
                  <Text style={styles.unknownText}>unknown</Text>
                  <View style={styles.requiredIndicator} />
                </View>
              )
            }
            showDividerTop
          />
          {showAdvanced.data && status.fileUri && (
            <LabeledValueRow
              label="File URI"
              value={status.fileUri}
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
    backgroundColor: colors.bgCanvas,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
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
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 18,
  },
  groupCard: {
    marginTop: 8,
    backgroundColor: colors.bgCanvas,
    borderRadius: 12,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  unknownValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unknownText: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  requiredIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textDanger,
  },
})
