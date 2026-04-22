import { TriangleAlertIcon } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, palette } from '../styles/colors'

type Props = {
  /**
   * When true, the banner is scheduled to appear. Visibility is delayed by
   * `appearDelayMs` so brief transient failures don't flash a banner.
   */
  active: boolean
  message: string
  actionLabel?: string
  onAction?: () => void
  appearDelayMs?: number
}

/**
 * Attention banner, rendered at the top of a surface when a non-fatal
 * issue needs the user's attention. Follows the iOS "iCloud: Sign-in
 * required" pattern — silent when things are fine, visible with a clear
 * message when something needs action.
 */
export function StatusBanner({
  active,
  message,
  actionLabel,
  onAction,
  appearDelayMs = 3000,
}: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (active) {
      const id = setTimeout(() => setVisible(true), appearDelayMs)
      return () => clearTimeout(id)
    }
    setVisible(false)
    return undefined
  }, [active, appearDelayMs])

  if (!visible) return null

  return (
    <View style={styles.banner}>
      <TriangleAlertIcon size={16} color={palette.yellow[400]} />
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={6}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgPanel,
    borderLeftWidth: 3,
    borderLeftColor: palette.yellow[400],
    borderRadius: 8,
  },
  message: {
    flex: 1,
    color: palette.gray[100],
    fontSize: 14,
  },
  action: {
    color: palette.blue[400],
    fontSize: 14,
    fontWeight: '600',
  },
})
