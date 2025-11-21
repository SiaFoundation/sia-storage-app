import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { palette } from '../styles/colors'
import { ArrowUp, ArrowDown, SortAsc, SortDesc } from 'lucide-react-native'
import {
  setSortCategory,
  SortBy,
  toggleDir,
  useLibrary,
} from '../stores/library'
import { ActionSheet } from '../components/ActionSheet'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { openSheet } from '../stores/sheets'

export function FileSorter(): React.ReactElement {
  const { sortBy, sortDir } = useLibrary()
  const isOpen = useSheetOpen('fileSorter')

  const onPick = (nextSortBy: SortBy) => {
    if (sortBy === nextSortBy) {
      toggleDir()
    } else {
      setSortCategory(nextSortBy)
    }
    closeSheet()
  }

  const ArrowIndicator = ({ row }: { row: SortBy }) => {
    if (sortBy !== row) return null
    const showUpIcon = row === 'NAME' ? sortDir === 'ASC' : sortDir === 'DESC'
    return showUpIcon ? <ArrowUp size={20} /> : <ArrowDown size={20} />
  }

  return (
    <>
      <Pressable
        style={styles.iconButton}
        onPress={() => openSheet('fileSorter')}
        accessibilityRole="button"
        accessibilityLabel="Open sort"
      >
        {(sortBy === 'NAME' ? sortDir === 'ASC' : sortDir === 'DESC') ? (
          <SortAsc size={18} color={palette.gray[50]} />
        ) : (
          <SortDesc size={18} color={palette.gray[50]} />
        )}
      </Pressable>
      <ActionSheet visible={isOpen} onRequestClose={closeSheet}>
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
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    backgroundColor: palette.gray[200],
    marginHorizontal: 12,
  },
})
