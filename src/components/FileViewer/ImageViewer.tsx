import { StyleSheet, Image, View } from 'react-native'
import { FileStatus } from '../../lib/file'

export default function ImageViewer({ status }: { status: FileStatus }) {
  return (
    <View>
      <Image
        source={{ uri: status.cachedUri! }}
        style={styles.image}
        resizeMode="cover"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
})
