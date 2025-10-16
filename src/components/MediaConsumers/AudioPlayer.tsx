import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import {
  AudioLinesIcon,
  PauseIcon,
  PlayIcon,
  Undo2Icon,
} from 'lucide-react-native'
import { StyleSheet, Text, View, ViewStyle } from 'react-native'

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
}: {
  source: string
  filename: string | null
  style?: ViewStyle
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
            <PauseIcon
              color="white"
              size={20}
              onPress={() => audioPlayer.pause()}
            />
          ) : (
            <PlayIcon
              color="white"
              size={20}
              onPress={() => {
                if (isReadyToPlay) audioPlayer.play()
              }}
            />
          )}
          <Undo2Icon color="white" onPress={() => audioPlayer.seekTo(0)} />
          <Text style={{ color: 'white' }}>
            {currentLabel} / {durationLabel}
          </Text>
        </View>
        {statusLabel && <Text style={{ color: 'white' }}>{statusLabel}</Text>}
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
    paddingBottom: 128,
  },
  audioInfo: { gap: 10, alignItems: 'center' },
  audioControlsRow: { alignItems: 'center', gap: 10 },
  audioControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
})
