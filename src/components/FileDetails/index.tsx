import React from 'react'
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native'
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
  const { height: windowHeight } = useWindowDimensions()

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {header}
        <View style={{ height: Math.round(windowHeight * 0.5) }}>
          <FileMap file={file} />
        </View>
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
    marginTop: 16,
    backgroundColor: colors.bgElevated,
  },
})
