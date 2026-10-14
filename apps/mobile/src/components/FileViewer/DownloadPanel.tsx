/**
 * What the viewer shows in place of a file that is not on the phone: one
 * large button that starts the download and then reports where it is.
 *
 * A tap gets an answer at once. `useDownload` checks the connection and the
 * free space before the download is registered, which takes long enough on a
 * phone that a button with no state of its own looked like it ignored the
 * tap. So the button shows "Starting" from the press until `onPress`
 * settles. The viewer's `onPress` settles once the request has registered
 * the download, or been refused, and the entry this button reads has caught
 * up, so the button goes straight to where the download is, failed again
 * included.
 */
import type { DownloadEntry } from '@siastorage/core/app'
import {
  CloudAlertIcon,
  CloudDownloadIcon,
  CloudOffIcon,
  type LucideIcon,
} from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { humanSize } from '../../lib/humanSize'
import { colors, palette } from '../../styles/colors'
import { CircularProgress } from '../CircularProgress'

type Props = {
  size: number
  entry: DownloadEntry | undefined
  isConnected: boolean
  /** Settles once the request is done and `entry` reflects it. */
  onPress: () => Promise<void>
}

type Look = {
  title: string
  detail: string
  icon: LucideIcon | 'spinner' | 'progress'
  tint: string
  canPress: boolean
}

function lookFor(
  size: number,
  entry: DownloadEntry | undefined,
  isConnected: boolean,
  starting: boolean,
): Look {
  const total = humanSize(size) ?? ''
  if (entry?.status === 'downloading') {
    const done = humanSize(Math.round(size * entry.progress)) ?? ''
    return {
      title: `Downloading ${Math.round(entry.progress * 100)}%`,
      detail: `${done} of ${total}`,
      icon: 'progress',
      tint: colors.accentPrimary,
      canPress: false,
    }
  }
  if (entry?.status === 'queued') {
    return {
      title: 'Waiting to download',
      detail: 'Starts when other downloads finish',
      icon: 'spinner',
      tint: colors.textSecondary,
      canPress: false,
    }
  }
  if (starting) {
    return {
      title: 'Starting download',
      detail: total,
      icon: 'spinner',
      tint: colors.accentPrimary,
      canPress: false,
    }
  }
  if (!isConnected) {
    return {
      title: 'Not connected',
      detail: 'Connect to download this file',
      icon: CloudOffIcon,
      tint: colors.textMuted,
      canPress: false,
    }
  }
  if (entry?.status === 'error') {
    return {
      title: 'Download failed',
      detail: 'Tap to try again',
      icon: CloudAlertIcon,
      tint: colors.textDanger,
      canPress: true,
    }
  }
  return {
    title: 'Download',
    detail: total,
    icon: CloudDownloadIcon,
    tint: colors.accentPrimary,
    canPress: true,
  }
}

export function DownloadPanel({ size, entry, isConnected, onPress }: Props) {
  const [starting, setStarting] = useState(false)
  const look = lookFor(size, entry, isConnected, starting)

  const press = async () => {
    setStarting(true)
    await onPress().catch(() => {})
    setStarting(false)
  }

  return (
    <View style={styles.container}>
      <Pressable
        testID="download-panel"
        accessibilityRole="button"
        accessibilityLabel={`${look.title}, ${look.detail}`}
        accessibilityState={{ disabled: !look.canPress, busy: !look.canPress && isConnected }}
        disabled={!look.canPress}
        onPress={press}
        hitSlop={16}
        style={({ pressed }) => [
          styles.button,
          look.canPress && styles.buttonReady,
          pressed && styles.buttonPressed,
        ]}
      >
        <View style={styles.icon}>
          {look.icon === 'progress' ? (
            <CircularProgress progress={entry?.progress ?? 0} size={44} strokeWidth={4} />
          ) : look.icon === 'spinner' ? (
            <ActivityIndicator color={look.tint} size="large" />
          ) : (
            <look.icon color={look.tint} size={40} />
          )}
        </View>
        <Text style={styles.title}>{look.title}</Text>
        <Text style={[styles.detail, look.tint === colors.textDanger && styles.detailDanger]}>
          {look.detail}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  button: {
    minWidth: 240,
    maxWidth: 320,
    paddingVertical: 28,
    paddingHorizontal: 32,
    borderRadius: 20,
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.gray[875],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  buttonReady: { backgroundColor: palette.gray[800] },
  buttonPressed: { backgroundColor: palette.gray[700], transform: [{ scale: 0.97 }] },
  icon: { height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  detail: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  detailDanger: { color: colors.textDanger },
})
