import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Square, CheckSquare } from 'lucide-react-native'
import { type Category, useFilesView } from '../stores/files'
import ActionSheet from '../components/ActionSheet'

const CATEGORIES: Category[] = ['Video', 'Image', 'Audio', 'Files']

export function FileFilter(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const { selectedCategories, toggleCategory, clearCategories } = useFilesView()

  const pressableText = useMemo(() => {
    const n = selectedCategories.size
    return n ? `Filter • ${n}` : 'Filter'
  }, [selectedCategories])

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
        style={styles.pressable}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
      >
        <Text style={styles.pressableText}>{pressableText}</Text>
      </Pressable>

      <ActionSheet visible={open} onRequestClose={() => setOpen(false)}>
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

          <Pressable onPress={() => setOpen(false)} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
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
  footer: {
    paddingTop: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  clear: { fontSize: 14, color: '#cc0000' },
  done: { fontSize: 14, fontWeight: '600' },
})
