import type React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useFileStatus } from '../../lib/file'
import type { FileRecord } from '../../stores/files'
import { colors, palette } from '../../styles/colors'
import { FileMeta } from './FileMeta'

export function FileDetails({
  file,
  header,
}: {
  file: FileRecord
  header?: React.ReactNode
}) {
  const status = useFileStatus(file)

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
