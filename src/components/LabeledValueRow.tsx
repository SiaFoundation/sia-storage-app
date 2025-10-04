import Clipboard from '@react-native-clipboard/clipboard'
import { useCallback } from 'react'
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native'
import { colors, palette } from '../styles/colors'
import { useToast } from '../lib/toastContext'

type Props = {
  label: string
  value: string | React.ReactNode
  isMonospace?: boolean
  numberOfLines?: number
  showDividerTop?: boolean
  canCopy?: boolean
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
  align?: 'left' | 'right'
  labelWidth?: number
}

const defaultLabelWidth = 96

export function LabeledValueRow({
  label,
  value,
  isMonospace = false,
  numberOfLines = 1,
  showDividerTop = false,
  canCopy = true,
  ellipsizeMode = 'tail',
  align = 'right',
  labelWidth,
}: Props) {
  const toast = useToast()

  const handleCopy = useCallback(() => {
    if (typeof value !== 'string') {
      return
    }
    Clipboard.setString(value)
    const lower = label.trim().length > 0 ? label.toLowerCase() : 'value'
    toast.show(`Copied ${lower}`)
  }, [label, toast, value])

  return canCopy ? (
    <Pressable accessibilityRole="button" onPress={handleCopy}>
      <View
        style={[
          styles.row,
          showDividerTop && styles.rowDivider,
          numberOfLines > 1
            ? { alignItems: 'flex-start' }
            : { alignItems: 'center' },
        ]}
      >
        <Text
          style={[styles.rowLabel, { width: labelWidth || defaultLabelWidth }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {typeof value === 'string' ? (
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
        ) : (
          value
        )}
      </View>
    </Pressable>
  ) : (
    <View style={[styles.row, showDividerTop && styles.rowDivider]}>
      <Text
        style={[styles.rowLabel, { width: labelWidth || defaultLabelWidth }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
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
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    color: palette.gray[300],
    marginRight: 8,
  },
  rowValue: { flex: 1, color: palette.gray[100] },
  rowValueMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
})
