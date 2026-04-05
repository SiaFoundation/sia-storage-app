import {
  Platform,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native'
import { colors, palette } from '../styles/colors'

type Props = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string
  showDividerTop?: boolean
  isMonospace?: boolean
  height?: number
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
  align?: 'left' | 'right'
  labelWidth?: number
  inputStyle?: StyleProp<TextStyle>
  containerStyle?: StyleProp<ViewStyle>
  placeholderTextColor?: string
}

const defaultLabelWidth = 200

export function InputArea({
  label,
  showDividerTop = false,
  isMonospace = false,
  inputStyle,
  containerStyle,
  placeholderTextColor,
  height = 80,
  ellipsizeMode = 'tail',
  align = 'left',
  labelWidth,
  ...textInputProps
}: Props) {
  return (
    <View style={[styles.container, showDividerTop && styles.rowDivider, { height }]}>
      <Text
        style={[styles.rowLabel, { maxWidth: labelWidth || defaultLabelWidth, flexShrink: 1 }]}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <TextInput
        style={[styles.input, isMonospace && styles.inputMono, inputStyle]}
        placeholderTextColor={placeholderTextColor ?? palette.gray[700]}
        clearButtonMode={textInputProps.clearButtonMode ?? 'while-editing'}
        autoCapitalize={textInputProps.autoCapitalize ?? 'none'}
        underlineColorAndroid="transparent"
        multiline={true}
        textAlign={align}
        textAlignVertical="top"
        {...textInputProps}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  rowDivider: {
    borderTopColor: colors.borderMutedLight,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    color: palette.gray[300],
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: 0,
    textAlign: 'right',
  },
  inputMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
})
