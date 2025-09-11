import { StyleSheet, View } from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'
import { FileStatus } from '../../lib/file'

export function VideoViewer({ status }: { status: FileStatus }) {
  const player = useVideoPlayer(status.cachedUri, (player) => {
    player.loop = true
    player.play()
  })

  return (
    <View style={styles.container}>
      <VideoView
        style={styles.video}
        player={player}
        allowsFullscreen
        allowsPictureInPicture
        contentFit="contain"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 400 },
  video: {
    width: '100%',
    height: '100%',
  },
})
