import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, palette, whiteA } from '../styles/colors'
import { Square, CheckSquare, Filter as FilterIcon } from 'lucide-react-native'
import {
  type Category,
  clearCategories,
  toggleCategory,
  useLibrary,
} from '../stores/library'
import { ActionSheet } from '../components/ActionSheet'
import { closeSheet, openSheet, useSheetOpen } from '../stores/sheets'

const CATEGORIES: Category[] = ['Video', 'Image', 'Audio', 'Files']

export function FileFilter(): React.ReactElement {
  const isOpen = useSheetOpen('fileFilter')
  const { selectedCategories } = useLibrary()

  const Row = ({ cat }: { cat: Category }) => {
    const checked = selectedCategories.has(cat)
    const Icon = checked ? CheckSquare : Square
    return (
      <Pressable
        style={styles.modalRow}
        onPress={() => toggleCategory(cat)}
        accessibilityRole="button"
        accessibilityLabel={checked ? `Unselect ${cat}` : `Select ${cat}`}
      >
        <Text style={styles.label}>{cat}</Text>
        <Icon size={20} />
      </Pressable>
    )
  }

  return (
    <>
      <Pressable
        style={styles.iconButton}
        onPress={() => openSheet('fileFilter')}
        accessibilityRole="button"
        accessibilityLabel="Open filter"
      >
        <FilterIcon
          size={18}
          color={selectedCategories.size ? palette.blue[400] : whiteA.a70}
        />
        {!!selectedCategories.size && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{selectedCategories.size}</Text>
          </View>
        )}
      </Pressable>
      <ActionSheet visible={isOpen} onRequestClose={closeSheet}>
        {CATEGORIES.map((c, i) => (
          <View key={c}>
            <Row cat={c} />
            {i < CATEGORIES.length - 1 && <View style={styles.separator} />}
          </View>
        ))}

        <View style={styles.footer}>
          <Pressable onPress={clearCategories} accessibilityRole="button">
            <Text style={styles.clear}>Clear</Text>
          </Pressable>

          <Pressable onPress={closeSheet} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
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
  badge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: palette.gray[50], fontSize: 10, fontWeight: '600' },
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
  footer: {
    paddingTop: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  clear: { fontSize: 14, color: palette.red[500] },
  done: { fontSize: 14, fontWeight: '600' },
})
