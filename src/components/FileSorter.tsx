import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { ArrowUp, ArrowDown } from 'lucide-react-native'
import { SortBy, useFilesView } from '../stores/files'
import ActionSheet from '../components/ActionSheet'

export function FileSorter(): React.ReactElement {
  const [open, setOpen] = useState(false)

  const { sortBy, sortDir, setSortCategory, toggleDir } = useFilesView()

  const pressableText = useMemo(() => {
    const label = sortBy === 'NAME' ? 'Name' : 'Date'
    const showUpArrow =
      sortBy === 'NAME' ? sortDir === 'ASC' : sortDir === 'DESC'
    return `${label} ${showUpArrow ? '↑' : '↓'}`
  }, [sortBy, sortDir])

  const onPick = (nextSortBy: SortBy) => {
    if (sortBy === nextSortBy) {
      toggleDir()
    } else {
      setSortCategory(nextSortBy)
    }
    setOpen(false)
  }

  const ArrowIndicator = ({ row }: { row: SortBy }) => {
    if (sortBy !== row) return null
    const showUpIcon = row === 'NAME' ? sortDir === 'ASC' : sortDir === 'DESC'
    return showUpIcon ? <ArrowUp size={20} /> : <ArrowDown size={20} />
  }

  return (
    <>
      <Pressable
        style={styles.pressable}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
      >
        <Text style={styles.pressableText}>{pressableText}</Text>
      </Pressable>

      <ActionSheet visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.modalRow}
          onPress={() => onPick('DATE')}
          accessibilityRole="button"
        >
          <Text style={styles.label}>Date</Text>
          <ArrowIndicator row="DATE" />
        </Pressable>

        <View style={styles.separator} />

        <Pressable
          style={styles.modalRow}
          onPress={() => onPick('NAME')}
          accessibilityRole="button"
        >
          <Text style={styles.label}>Name</Text>
          <ArrowIndicator row="NAME" />
        </Pressable>
      </ActionSheet>
    </>
  )
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  pressableText: { fontSize: 14 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { fontSize: 16 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ddd',
    marginHorizontal: 12,
  },
})
