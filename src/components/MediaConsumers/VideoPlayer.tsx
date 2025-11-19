import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'
import { PlayIcon } from 'lucide-react-native'
import { palette } from '../../styles/colors'
import { logger } from '../../lib/logger'

export function VideoPlayer({
  source,
  style,
}: {
  source: string
  style?: ViewStyle
}) {
  const player = useVideoPlayer(source)
  const videoRef = useRef<VideoView>(null)
  const [showNativeControls, setShowNativeControls] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const onPlayPress = async () => {
    setIsPlaying(true)
    player.play()
    try {
      await videoRef.current?.enterFullscreen()
    } catch (error) {
      logger.log('[VideoPlayer] Failed to enter fullscreen:', error)
    }
  }

  return (
    <View style={[styles.container, style]}>
      <VideoView
        ref={videoRef}
        style={StyleSheet.absoluteFill}
        player={player}
        allowsFullscreen
        allowsPictureInPicture
        contentFit="contain"
        nativeControls={showNativeControls}
        onFullscreenEnter={() => setShowNativeControls(true)}
        onFullscreenExit={() => {
          setShowNativeControls(false)
          player.pause()
          setIsPlaying(false)
        }}
      />
      {!isPlaying && (
        <View style={styles.playIconContainer} pointerEvents="box-none">
          <Pressable
            style={styles.playButton}
            onPress={onPlayPress}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Play video in fullscreen"
          >
            <PlayIcon color={palette.gray[200]} size={56} />
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  playIconContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  playButton: {
    padding: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
})
