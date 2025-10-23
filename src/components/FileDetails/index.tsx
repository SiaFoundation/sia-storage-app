import React from 'react'
import { View, StyleSheet, ScrollView } from 'react-native'
import { colors, palette } from '../../styles/colors'
import { type FileRecord } from '../../stores/files'
import { useFileStatus } from '../../lib/file'
import { FileMeta } from './FileMeta'
import { FileMap } from './FileMap'

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
        <View style={styles.mapContainer}>
          <FileMap file={file} />
        </View>
        <View style={styles.metaContainer}>
          <FileMeta file={file} status={status} />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950] },
  scrollContent: { paddingBottom: 96 },
  metaContainer: { marginTop: 16, backgroundColor: colors.bgElevated },
  mapContainer: { height: '100%' },
})
