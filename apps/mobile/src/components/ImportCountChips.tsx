import type { ImportSummary } from '@siastorage/core/db/operations'
import { StyleSheet, Text, View } from 'react-native'
import { countChips } from '../lib/importLabels'
import { palette } from '../styles/colors'

type Props = {
  summary: ImportSummary
}

/**
 * The added / duplicate / unavailable / failed / cancelled count chips for an
 * import summary. Zero-count states are dropped.
 */
export function ImportCountChips({ summary }: Props) {
  const chips = countChips(summary)
  if (chips.length === 0) return null
  return (
    <View style={styles.row}>
      {chips.map((chip) => (
        <View key={chip.label} style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: chip.color }]} />
          <Text style={styles.chipText}>
            {chip.count.toLocaleString()} {chip.label.toLowerCase()}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: palette.gray[800],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    color: palette.gray[300],
    fontSize: 12,
    fontWeight: '500',
  },
})
