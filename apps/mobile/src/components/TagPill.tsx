import type { Tag } from '@siastorage/core/db/operations'
import { XIcon } from 'lucide-react-native'
import type React from 'react'
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { overlay, palette, whiteA } from '../styles/colors'

type TagPillProps = {
  tag: Tag
  selected?: boolean
  onPress?: () => void
  onRemove?: () => void
  style?: ViewStyle
}

export function TagPill({
  tag,
  selected = false,
  onPress,
  onRemove,
  style,
}: TagPillProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? palette.blue[500] : overlay.panelMedium,
          borderColor: selected ? palette.blue[500] : whiteA.a10,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.text} numberOfLines={1}>
          {tag.name}
        </Text>
        {onRemove && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tag.name}`}
            onPress={onRemove}
            hitSlop={8}
            style={styles.removeButton}
          >
            <XIcon size={12} color={whiteA.a70} />
          </Pressable>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  text: {
    color: palette.gray[50],
    fontSize: 11,
    fontWeight: '500',
  },
  removeButton: {
    marginLeft: 2,
  },
})
