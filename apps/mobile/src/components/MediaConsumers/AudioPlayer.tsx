import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { AudioLinesIcon, PauseIcon, PlayIcon, Undo2Icon } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'

function formatPlayTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export function AudioPlayer({
  source,
  filename,
  style,
  onViewerControlPress,
}: {
  source: string
  filename: string | null
  style?: ViewStyle
  onViewerControlPress?: () => void
}) {
  const audioPlayer = useAudioPlayer(source)
  const { isLoaded, isBuffering, playing, duration, currentTime } =
    useAudioPlayerStatus(audioPlayer)

  const isReadyToPlay = isLoaded && !isBuffering
  const currentLabel = isReadyToPlay ? formatPlayTime(currentTime) : '--:--'
  const durationLabel = isReadyToPlay ? formatPlayTime(duration) : '--:--'
  const statusLabel = !isLoaded ? 'Loading' : isBuffering ? 'Buffering' : null

  return (
    <View style={[styles.container, style]}>
      <View style={styles.audioInfo}>
        <AudioLinesIcon color="white" size={80} />
        <Text style={{ color: 'white' }}>{filename}</Text>
      </View>
      <View style={styles.audioControlsRow}>
        <View style={styles.audioControls}>
          {playing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pause"
              onPress={() => {
                onViewerControlPress?.()
                audioPlayer.pause()
              }}
            >
              <PauseIcon color="white" size={20} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play"
              // The `disabled` prop would also drop the tap, and the tap still
              // has to reach onViewerControlPress before audio is ready.
              accessibilityState={{ disabled: !isReadyToPlay }}
              onPress={() => {
                onViewerControlPress?.()
                if (isReadyToPlay) audioPlayer.play()
              }}
            >
              <PlayIcon color="white" size={20} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Restart"
            onPress={() => {
              onViewerControlPress?.()
              audioPlayer.seekTo(0)
            }}
          >
            <Undo2Icon color="white" />
          </Pressable>
          <Text style={{ color: 'white' }}>
            {currentLabel} / {durationLabel}
          </Text>
        </View>
        <View style={styles.statusPlaceholder}>
          {statusLabel ? <Text style={{ color: 'white' }}>{statusLabel}</Text> : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
  },
  audioInfo: { gap: 10, alignItems: 'center' },
  audioControlsRow: { alignItems: 'center', gap: 10 },
  audioControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusPlaceholder: {
    minHeight: 18,
    justifyContent: 'center',
  },
})
