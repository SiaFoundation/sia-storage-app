import { UNFILED_DIRECTORY_ID } from '@siastorage/core/db/operations'
import { Pressable, StyleSheet, type StyleProp, Text, type ViewStyle } from 'react-native'
import { navigateToImports } from '../lib/navigationRef'
import { useInFlightCountForDirectory } from '../stores/imports'
import { colors, palette } from '../styles/colors'

/**
 * Staged files appear in their folder only at finalize, so a folder someone
 * just imported into looks empty. This banner names the in-flight count and
 * links to the imports list. On the root view (`directoryId` null) it counts
 * across every import, since root is also where destination-less imports land.
 * Unfiled counts only the imports staged with no destination.
 */
export function FolderImportBanner({
  directoryId,
  style,
}: {
  directoryId: string | null
  /** Overrides for the mount's gutters (the grid's padded content already
   * provides the side margins the banner defaults to). */
  style?: StyleProp<ViewStyle>
}) {
  const { data: count } = useInFlightCountForDirectory(directoryId)
  if (!count) return null
  const noun = count === 1 ? '1 file' : `${count.toLocaleString()} files`
  const intoFolder = directoryId !== null && directoryId !== UNFILED_DIRECTORY_ID
  return (
    <Pressable
      accessibilityRole="button"
      onPress={navigateToImports}
      style={({ pressed }) => [styles.banner, pressed ? styles.pressed : null, style]}
    >
      <Text style={styles.text}>
        {intoFolder ? `${noun} importing into this folder` : `${noun} importing`}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pressed: {
    backgroundColor: palette.gray[800],
  },
  text: {
    color: palette.blue[400],
    fontSize: 14,
    fontWeight: '500',
  },
})
