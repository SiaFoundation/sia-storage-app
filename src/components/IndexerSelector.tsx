import React from 'react'
import { StyleSheet, View, Text, Pressable } from 'react-native'
import { palette } from '../styles/colors'
import { InfoCard } from './InfoCard'
import { InputRow } from './InputRow'
import { DEFAULT_INDEXER_URL } from '../config'

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
            <Text style={styles.optionTitle}>Enter a provider URL</Text>
          </View>
        </Pressable>
        {isUsingCustomProvider ? (
          <View style={styles.customInput}>
            <InputRow
              label="Provider URL"
              align="left"
              labelWidth={96}
              keyboardType="url"
              autoCorrect={false}
              placeholder="https://"
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
    textAlign: 'center',
  },
  optionCard: {
    padding: 20,
    gap: 16,
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
  customInput: {
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: palette.gray[950],
  },
})
