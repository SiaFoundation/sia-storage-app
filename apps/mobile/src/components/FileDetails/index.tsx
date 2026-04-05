import type { FileRecord } from '@siastorage/core/types'
import type React from 'react'
import { StyleSheet, View } from 'react-native'
// RNGH ScrollView instead of RN ScrollView so it can negotiate with other
// gesture handlers in the tree. The standard RN ScrollView doesn't receive
// scroll events on Android when nested inside a GestureHandlerRootView.
import { ScrollView } from 'react-native-gesture-handler'
import { useFileStatus } from '../../lib/file'
import { colors, palette } from '../../styles/colors'
import { FileMeta } from './FileMeta'

export function FileDetails({ file, header }: { file: FileRecord; header?: React.ReactNode }) {
  const status = useFileStatus(file)

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {header}
        <View style={styles.metaContainer}>
          {status.data ? <FileMeta file={file} status={status.data} /> : null}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950] },
  scrollContent: { paddingBottom: 96 },
  metaContainer: {
    backgroundColor: colors.bgElevated,
  },
})
