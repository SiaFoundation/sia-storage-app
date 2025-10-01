import { StyleSheet, TextInput, Platform } from 'react-native'
import {
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { LabeledValueRow } from './LabeledValueRow'

type Props = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string
  showDividerTop?: boolean
  isMonospace?: boolean
  numberOfLines?: number
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
  align?: 'left' | 'right'
  labelWidth?: number
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
  numberOfLines = 1,
  ellipsizeMode = 'tail',
  align = 'right',
  labelWidth,
  ...textInputProps
}: Props) {
  return (
    <LabeledValueRow
      label={label}
      showDividerTop={showDividerTop}
      isMonospace={isMonospace}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      align={align}
      labelWidth={labelWidth}
      value={
        <TextInput
          style={[styles.input, isMonospace && styles.inputMono, inputStyle]}
          placeholderTextColor={placeholderTextColor ?? '#9ca3af'}
          clearButtonMode={textInputProps.clearButtonMode ?? 'while-editing'}
          autoCapitalize={textInputProps.autoCapitalize ?? 'none'}
          underlineColorAndroid="transparent"
          {...textInputProps}
        />
      }
    />
  )
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    color: '#111827',
    paddingVertical: 0,
    textAlign: 'right',
  },
  inputMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
})
