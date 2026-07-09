import type React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { palette } from '../styles/colors'

/**
 * Shared row for the status sheet's file lists (Uploads, Unavailable): an
 * optional thumbnail box, name over one detail line, and a trailing slot.
 * The thumbnail box is fixed-size and clipped because FileThumbnail sizes to
 * its container; mounted unconstrained it grows to the loaded image's size.
 */
export function StatusFileRow({
  thumbnail,
  name,
  detail,
  trailing,
  first,
  onPress,
}: {
  thumbnail?: React.ReactNode
  name: string
  detail: string
  trailing: React.ReactNode
  first: boolean
  onPress?: () => void
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.rowBorder,
        pressed && onPress ? styles.rowPressed : null,
      ]}
    >
      {thumbnail !== undefined ? <View style={styles.thumb}>{thumbnail}</View> : null}
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {trailing}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.gray[800],
  },
  rowPressed: {
    opacity: 0.6,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gray[800],
  },
  rowText: {
    flex: 1,
  },
  name: {
    color: palette.gray[50],
    fontSize: 15,
    fontWeight: '500',
  },
  detail: {
    color: palette.gray[400],
    fontSize: 13,
    marginTop: 2,
  },
})
