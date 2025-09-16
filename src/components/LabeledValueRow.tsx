import Clipboard from '@react-native-clipboard/clipboard'
import { useCallback } from 'react'
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native'
import { useToast } from '../lib/toastContext'

type Props = {
  label: string
  value: string
  isMonospace?: boolean
  numberOfLines?: number
  showDividerTop?: boolean
  canCopy?: boolean
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
  align?: 'left' | 'right'
}

export function LabeledValueRow({
  label,
  value,
  isMonospace = false,
  numberOfLines = 1,
  showDividerTop = false,
  canCopy = true,
  ellipsizeMode = 'tail',
  align = 'right',
}: Props) {
  const toast = useToast()

  const handleCopy = useCallback(() => {
    Clipboard.setString(value)
    const lower = label.trim().length > 0 ? label.toLowerCase() : 'value'
    toast.show(`Copied ${lower}`)
  }, [label, toast, value])

  return canCopy ? (
    <Pressable accessibilityRole="button" onPress={handleCopy}>
      <View style={[styles.row, showDividerTop && styles.rowDivider]}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text
          style={[
            styles.rowValue,
            isMonospace && styles.rowValueMono,
            { textAlign: align },
          ]}
          numberOfLines={numberOfLines}
          ellipsizeMode={ellipsizeMode}
        >
          {value}
        </Text>
      </View>
    </Pressable>
  ) : (
    <View style={[styles.row, showDividerTop && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, isMonospace && styles.rowValueMono]}
        numberOfLines={numberOfLines}
        ellipsizeMode={ellipsizeMode}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    width: 96,
    color: '#6b7280',
    marginRight: 8,
  },
  rowValue: { flex: 1, color: '#111827' },
  rowValueMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
})
