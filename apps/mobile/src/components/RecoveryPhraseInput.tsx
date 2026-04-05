import { Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { palette } from '../styles/colors'

type RecoveryPhraseInputProps = {
  value: string
  onChangeText: (text: string) => void
  isValid: boolean
  normalizedValue: string
  validationError: string | null
  editable?: boolean
  placeholder?: string
}

export function RecoveryPhraseInput({
  value,
  onChangeText,
  isValid,
  normalizedValue,
  validationError,
  editable = true,
  placeholder = 'Enter your 12 or 24 word recovery phrase',
}: RecoveryPhraseInputProps) {
  return (
    <>
      <View
        style={[
          styles.inputBox,
          isValid
            ? styles.inputBoxValid
            : normalizedValue
              ? styles.inputBoxInvalid
              : styles.inputBoxNeutral,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.gray[500]}
          multiline
          scrollEnabled
          style={styles.textInput}
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          editable={editable}
        />
      </View>

      {normalizedValue ? (
        <Text
          style={[
            styles.validationText,
            isValid ? styles.validationTextValid : styles.validationTextInvalid,
          ]}
        >
          {isValid ? 'Recovery phrase is valid.' : (validationError ?? 'Invalid recovery phrase.')}
        </Text>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  inputBox: {
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#000',
  },
  inputBoxNeutral: { borderColor: palette.gray[700] },
  inputBoxValid: { borderColor: palette.green[500] },
  inputBoxInvalid: { borderColor: palette.red[500] },
  textInput: {
    color: palette.gray[100],
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 0,
    flex: 1,
    textAlign: 'left',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  validationText: { fontSize: 13 },
  validationTextValid: { color: palette.green[500] },
  validationTextInvalid: { color: palette.red[500] },
})
