import type { ImportFileRow } from '@siastorage/core/db/operations'
import { StyleSheet, Text, View } from 'react-native'
import { fileRowStyle } from '../lib/importLabels'
import { palette } from '../styles/colors'
import { SpinnerIcon } from './SpinnerIcon'

type Props = {
  row: Pick<ImportFileRow, 'state' | 'attempts' | 'nextAttemptAt' | 'reason'>
  now: number
}

/**
 * A small pill for a single import_files row's state. Actively-working states
 * spin; a pending row in backoff shows "Retrying (n/N)" without a spinner
 * because it is sleeping, not working.
 */
export function ImportFileStateBadge({ row, now }: Props) {
  const style = fileRowStyle(row, now)
  return (
    <View style={styles.pill}>
      {style.spinner ? <SpinnerIcon color={style.color} size={12} /> : null}
      <Text style={[styles.label, { color: style.color }]}>{style.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: palette.gray[800],
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
})
