import React from 'react'
import { View, StyleSheet, ScrollView } from 'react-native'
import { colors, palette } from '../../styles/colors'
import { type FileRecord } from '../../stores/files'
import { useFileStatus } from '../../lib/file'
import { FileViewer } from '../FileViewer'
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
        <View style={styles.viewerWrap}>
          <FileViewer file={file} />
        </View>
        <View style={styles.metaWrap}>
          <FileMeta file={file} status={status} />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950] },
  scrollContent: { paddingBottom: 96 },
  viewerWrap: {},
  metaWrap: { marginTop: 16, backgroundColor: colors.bgElevated },
})
