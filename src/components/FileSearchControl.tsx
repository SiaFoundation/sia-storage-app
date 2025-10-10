import React from 'react'
import { View, Pressable, StyleSheet } from 'react-native'
import { SearchIcon } from 'lucide-react-native'
import { palette, whiteA } from '../styles/colors'
import { useFilesView } from '../stores/files'

export function FileSearchControl({
  onOpen,
}: {
  onOpen?: () => void
}): React.ReactElement {
  const { searchQuery } = useFilesView()
  const applied = (searchQuery?.trim().length ?? 0) > 0
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={styles.iconButton}
    >
      <SearchIcon size={18} color={applied ? palette.blue[400] : whiteA.a70} />
      {applied && <View style={styles.dot} />}
    </Pressable>
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
