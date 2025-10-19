import React from 'react'
import { View, StyleSheet } from 'react-native'
import { SearchIcon } from 'lucide-react-native'
import { palette, whiteA } from '../styles/colors'
import { useLibrary } from '../stores/library'
import { IconButton } from './IconButton'

export function FileSearchControl({
  onOpen,
}: {
  onOpen?: () => void
}): React.ReactElement {
  const { searchQuery, selectedCategories } = useLibrary()
  const hasQuery = (searchQuery?.trim().length ?? 0) > 0
  const hasFilters = (selectedCategories?.size ?? 0) > 0
  const applied = hasQuery || hasFilters
  return (
    <IconButton onPress={onOpen}>
      <SearchIcon size={18} color={applied ? palette.blue[400] : whiteA.a70} />
      {applied && <View style={styles.dot} />}
    </IconButton>
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
  dot: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.blue[400],
  },
})
