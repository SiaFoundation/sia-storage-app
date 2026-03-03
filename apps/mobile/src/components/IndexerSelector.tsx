import { DEFAULT_INDEXER_URL } from '@siastorage/core/config'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, palette } from '../styles/colors'
import { InfoCard } from './InfoCard'

type IndexerSelectorProps = {
  value: string
  onChangeText: (text: string) => void
  hasErrored?: boolean
}

export function IndexerSelector({
  value,
  onChangeText,
  hasErrored = false,
}: IndexerSelectorProps) {
  const trimmedValue = value.trim()
  const isUsingCustomProvider = trimmedValue !== DEFAULT_INDEXER_URL

  const handleSelectDefault = () => {
    onChangeText(DEFAULT_INDEXER_URL)
  }

  const handleUseCustom = () => {
    if (!isUsingCustomProvider) {
      onChangeText('')
    }
  }

  return (
    <>
      {hasErrored ? (
        <Text style={styles.errorText}>
          Could not connect. Check the URL and try again.
        </Text>
      ) : null}

      <InfoCard
        style={[
          styles.optionCard,
          !isUsingCustomProvider && styles.optionCardActive,
        ]}
      >
        <Pressable
          testID="indexer-option-default"
          accessibilityRole="radio"
          accessibilityState={{ selected: !isUsingCustomProvider }}
          onPress={handleSelectDefault}
          style={styles.optionPressable}
        >
          <View style={styles.radioOuter}>
            {!isUsingCustomProvider ? <View style={styles.radioInner} /> : null}
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Sia Storage</Text>
          </View>
        </Pressable>
      </InfoCard>

      <InfoCard
        style={[
          styles.optionCard,
          isUsingCustomProvider && styles.optionCardActive,
        ]}
      >
        <Pressable
          testID="indexer-option-custom"
          accessibilityRole="radio"
          accessibilityState={{ selected: isUsingCustomProvider }}
          onPress={handleUseCustom}
          style={styles.optionPressable}
        >
          <View style={styles.radioOuter}>
            {isUsingCustomProvider ? <View style={styles.radioInner} /> : null}
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Custom Indexer</Text>
          </View>
        </Pressable>
        {isUsingCustomProvider ? (
          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Indexer URL</Text>
            <TextInput
              style={styles.textInput}
              placeholder="https://sia.storage"
              placeholderTextColor={palette.gray[400]}
              keyboardType="url"
              autoCorrect={false}
              autoCapitalize="none"
              value={value}
              onChangeText={onChangeText}
            />
          </View>
        ) : null}
      </InfoCard>
    </>
  )
}

const styles = StyleSheet.create({
  errorText: {
    color: palette.red[500],
    fontSize: 12,
  },
  optionCard: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  optionCardActive: {
    borderColor: palette.blue[400],
    backgroundColor: palette.gray[900],
  },
  optionPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: palette.gray[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.blue[400],
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '700',
  },
  inputWrap: {
    gap: 6,
  },
  inputLabel: {
    color: palette.gray[300],
    fontSize: 13,
    fontWeight: '600',
  },
  textInput: {
    color: colors.textPrimary,
    backgroundColor: palette.gray[950],
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
})
