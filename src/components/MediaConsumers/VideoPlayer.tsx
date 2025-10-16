import { ViewStyle } from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'

export function VideoPlayer({
  source,
  style,
}: {
  source: string
  style?: ViewStyle
}) {
  const player = useVideoPlayer(source)
  return (
    <VideoView
      style={[{ flex: 1 }, style]}
      player={player}
      allowsFullscreen
      allowsPictureInPicture
      contentFit="contain"
    />
  )
}
