import { View, Text, StyleSheet, TextInput, Platform } from 'react-native'
import {
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'

type Props = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string
  showDividerTop?: boolean
  isMonospace?: boolean
  inputStyle?: StyleProp<TextStyle>
  containerStyle?: StyleProp<ViewStyle>
  placeholderTextColor?: string
}

export function InputRow({
  label,
  showDividerTop = false,
  isMonospace = false,
  inputStyle,
  containerStyle,
  placeholderTextColor,
  ...textInputProps
}: Props) {
  const isMultiline = textInputProps.multiline === true

  return (
    <View
      style={[styles.row, showDividerTop && styles.rowDivider, containerStyle]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          isMonospace && styles.inputMono,
          isMultiline && styles.inputMultiline,
          inputStyle,
        ]}
        placeholderTextColor={placeholderTextColor ?? '#9ca3af'}
        clearButtonMode={textInputProps.clearButtonMode ?? 'while-editing'}
        autoCapitalize={textInputProps.autoCapitalize ?? 'none'}
        underlineColorAndroid="transparent"
        {...textInputProps}
      />
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
  input: {
    flex: 1,
    color: '#111827',
    paddingVertical: 0,
    textAlign: 'right',
  },
  inputMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  inputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
    paddingTop: 0,
  },
})
