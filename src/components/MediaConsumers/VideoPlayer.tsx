import { useVideoPlayer, VideoView } from 'expo-video'
import { PlayIcon } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { logger } from '../../lib/logger'
import { palette } from '../../styles/colors'

export function VideoPlayer({
  source,
  style,
  onViewerControlPress,
}: {
  source: string
  style?: ViewStyle
  onViewerControlPress?: () => void
}) {
  const player = useVideoPlayer(source)
  const videoRef = useRef<VideoView>(null)
  const [showNativeControls, setShowNativeControls] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const onPlayPress = useCallback(async () => {
    setIsPlaying(true)
    player.play()
    try {
      await videoRef.current?.enterFullscreen()
    } catch (error) {
      logger.error('VideoPlayer', 'fullscreen_error', { error: error as Error })
    }
  }, [player])

  const handlePressIn = useCallback(() => {
    onViewerControlPress?.()
  }, [onViewerControlPress])

  return (
    <View style={[styles.container, style]}>
      <VideoView
        ref={videoRef}
        style={StyleSheet.absoluteFill}
        player={player}
        fullscreenOptions={{
          enable: true,
          orientation: 'default',
          autoExitOnRotate: false,
        }}
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
            onPressIn={handlePressIn}
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
