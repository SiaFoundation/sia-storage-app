import { useShowAdvanced } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { FileStatus } from '../../lib/file'
import { colors } from '../../styles/colors'
import { InsetGroupCopyRow, InsetGroupSection, InsetGroupValueRow } from '../InsetGroup'

function UnknownValue() {
  return (
    <View style={styles.unknownValue}>
      <Text style={styles.unknownText}>unknown</Text>
      <View style={styles.requiredIndicator} />
    </View>
  )
}

export function FileMetaImport({ file, status }: { file: FileRecord; status: FileStatus }) {
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
      <InsetGroupSection header="Details">
        {hasValidSize ? (
          <InsetGroupValueRow label="Size" value={humanSize ?? '—'} />
        ) : (
          <InsetGroupValueRow label="Size" valueSlot={<UnknownValue />} />
        )}
        {hasValidType ? (
          <InsetGroupValueRow label="Type" value={file.type} />
        ) : (
          <InsetGroupValueRow label="Type" valueSlot={<UnknownValue />} />
        )}
        {hasValidHash ? (
          <InsetGroupCopyRow label="Hash" value={file.hash ?? ''} />
        ) : (
          <InsetGroupValueRow label="Hash" valueSlot={<UnknownValue />} />
        )}
      </InsetGroupSection>

      {showAdvanced.data ? (
        <InsetGroupSection header="Identity">
          <InsetGroupCopyRow label="ID" value={file.id} />
          {status.fileUri ? <InsetGroupCopyRow label="File URI" value={status.fileUri} /> : null}
        </InsetGroupSection>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: colors.bgCanvas,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
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
