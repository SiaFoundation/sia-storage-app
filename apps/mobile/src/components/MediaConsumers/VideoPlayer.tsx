import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { PlayIcon } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { useThumbnailUri } from '../../hooks/useBestThumbnail'
import { palette } from '../../styles/colors'

/**
 * A video in the viewer: its thumbnail, and a player only while it is playing.
 *
 * Playing always goes fullscreen, so a player on the page would exist only to
 * draw a still frame while holding a buffer to do it. The carousel keeps several
 * pages alive at once for smooth swiping, and those buffers come out of a Java
 * heap the device caps per app whatever its RAM: 256 MB on a Pixel 10, lower on
 * smaller devices, which a few large videos in the window exhausted between
 * them. A thumbnail costs neither, and every page can show one.
 */
export function VideoPlayer({
  file,
  source,
  style,
  onViewerControlPress,
}: {
  file: FileRecord
  source: string
  style?: ViewStyle
  onViewerControlPress?: () => void
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  // Falls back to the device photo-library tile for a video whose thumbnail
  // has not been generated yet, which would otherwise leave the page blank
  // behind the play button. onError fires only for that fallback and marks
  // the asset unrenderable so it stops being retried.
  const { uri: thumbUri, isOsFallback, onOsError } = useThumbnailUri(file)

  return (
    <View style={[styles.container, style]}>
      {thumbUri ? (
        <Image
          source={thumbUri}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          recyclingKey={file.id}
          onError={isOsFallback ? onOsError : undefined}
        />
      ) : null}
      {isPlaying ? (
        <PlayingVideo source={source} onExit={() => setIsPlaying(false)} />
      ) : (
        <View style={styles.overlay} pointerEvents="box-none">
          <Pressable
            style={styles.button}
            onPressIn={() => onViewerControlPress?.()}
            onPress={() => setIsPlaying(true)}
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

/**
 * Sources are files already on the device, so the default target of around
 * 138 MB is read-ahead against a network that is not involved. 32 MB is still
 * several seconds of high-bitrate video, enough to keep playback and scrubbing
 * off the disk. Assigned whole because setting individual fields is
 * unsupported.
 */
const VIDEO_BUFFER_OPTIONS = {
  maxBufferBytes: 32 * 1024 * 1024,
  preferredForwardBufferDuration: 10,
}

/** Owns the player, so it exists for exactly as long as playback does. */
function PlayingVideo({ source, onExit }: { source: string; onExit: () => void }) {
  const player = useVideoPlayer(source, (p) => {
    p.bufferOptions = VIDEO_BUFFER_OPTIONS
    p.play()
  })
  const videoRef = useRef<VideoView>(null)
  const requested = useRef(false)

  // Going fullscreen resolves the view by tag natively, and that registration
  // lands after a mount effect runs: the ref is set, the lookup still throws.
  // onLayout comes from the native view, so it cannot fire too early.
  function enterFullscreen() {
    if (requested.current) return
    requested.current = true
    videoRef.current?.enterFullscreen().catch((error) => {
      logger.error('VideoPlayer', 'fullscreen_error', { error: error as Error })
      // Playback starts as the player is created, so a failure here leaves it
      // running with nothing on screen until the unmount lands.
      player.pause()
      onExit()
    })
  }

  return (
    <VideoView
      ref={videoRef}
      onLayout={enterFullscreen}
      style={StyleSheet.absoluteFill}
      player={player}
      fullscreenOptions={{ enable: true, orientation: 'default', autoExitOnRotate: false }}
      allowsPictureInPicture
      contentFit="contain"
      nativeControls
      onFullscreenExit={() => {
        // Exiting only schedules the unmount, so without this the player keeps
        // playing until React commits.
        player.pause()
        onExit()
      }}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  button: {
    padding: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
})
