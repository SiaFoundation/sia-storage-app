import Clipboard from '@react-native-clipboard/clipboard'
import { useCallback } from 'react'
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native'
import { useToast } from '../lib/toastContext'
import { colors, palette } from '../styles/colors'

type Props = {
  label: string
  description?: string
  value: string | React.ReactNode
  isMonospace?: boolean
  numberOfLines?: number
  showDividerTop?: boolean
  canCopy?: boolean
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
  align?: 'left' | 'right'
  labelWidth?: number
  labelStyle?: TextStyle
}

const defaultLabelWidth = 96

export function LabeledValueRow({
  label,
  description,
  value,
  isMonospace = false,
  numberOfLines = 1,
  showDividerTop = false,
  canCopy = true,
  ellipsizeMode = 'tail',
  align = 'right',
  labelWidth,
  labelStyle,
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

  const valueContent =
    typeof value === 'string' ? (
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
    )

  const rowContent = (
    <View style={[styles.row, showDividerTop && styles.rowDivider]}>
      <View style={{ flex: 1 }}>
        <View
          style={[
            styles.rowInner,
            numberOfLines > 1
              ? { alignItems: 'flex-start' }
              : { alignItems: 'center' },
          ]}
        >
          <Text
            style={[
              styles.rowLabel,
              { maxWidth: labelWidth || defaultLabelWidth, flexShrink: 1 },
              labelStyle,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {label}
          </Text>
          {valueContent}
        </View>
        {description ? (
          <Text style={styles.rowDescription}>{description}</Text>
        ) : null}
      </View>
    </View>
  )

  return canCopy ? (
    <Pressable accessibilityRole="button" onPress={handleCopy}>
      {rowContent}
    </Pressable>
  ) : (
    rowContent
  )
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  rowDescription: {
    color: palette.gray[400],
    fontSize: 13,
    marginTop: 8,
  },
})
