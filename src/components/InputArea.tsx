import { StyleSheet, TextInput, Platform, View, Text } from 'react-native'
import { colors, palette } from '../styles/colors'
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
  align = 'right',
  labelWidth,
  ...textInputProps
}: Props) {
  return (
    <View
      style={[
        styles.container,
        showDividerTop && styles.rowDivider,
        { height },
      ]}
    >
      <Text
        style={[styles.rowLabel, { width: labelWidth || defaultLabelWidth }]}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <TextInput
        style={[styles.input, isMonospace && styles.inputMono, inputStyle]}
        placeholderTextColor={placeholderTextColor ?? palette.gray[400]}
        clearButtonMode={textInputProps.clearButtonMode ?? 'while-editing'}
        autoCapitalize={textInputProps.autoCapitalize ?? 'none'}
        underlineColorAndroid="transparent"
        textAlign="left"
        {...textInputProps}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopColor: colors.borderMutedLight,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    color: palette.gray[500],
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
