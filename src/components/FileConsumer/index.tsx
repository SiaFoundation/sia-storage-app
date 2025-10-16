import { StyleSheet, Text, TouchableHighlight, View } from 'react-native'
import { FileRecord } from '../../stores/files'
import { useFileStatus } from '../../lib/file'
import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'
import { ImageViewer } from '../MediaConsumers/ImageViewer'
import { VideoPlayer } from '../MediaConsumers/VideoPlayer'
import { AudioPlayer } from '../MediaConsumers/AudioPlayer'
import { PDFViewer } from '../MediaConsumers/PDFViewer'
import { TextViewer } from '../MediaConsumers/TextViewer'
import { MarkdownViewer } from '../MediaConsumers/MarkdownViewer'
import { JSONViewer } from '../MediaConsumers/JSONViewer'
import { useDownload } from '../../managers/downloader'
import { useDownloadState } from '../../stores/downloads'
import { colors } from '../../styles/colors'

export function FileConsumer({
  file,
  header,
}: {
  file: FileRecord
  header: React.ReactNode
}) {
  const { fileType } = file
  const status = useFileStatus(file)
  const fileDownload = useDownload(file)
  const fileDownloadState = useDownloadState(file.id)

  const MediaDisplayComponent = () => {
    // First, handle when the file isn't on the local device.
    if (!status.isDownloaded || !status.cachedUri) {
      return (
        <View
          style={{
            ...styles.mediaWithPadding,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            gap: 20,
          }}
        >
          <TouchableHighlight
            onLongPress={() => {
              if (status.isDownloading) return
              fileDownload()
            }}
          >
            <CloudDownloadIcon color={colors.textPrimary} size={40} />
          </TouchableHighlight>
          {!status.isDownloading ? (
            <Text style={{ color: colors.textPrimary }}>
              Long press to download
            </Text>
          ) : null}
          {status.isDownloading ? (
            <Text style={{ color: colors.textPrimary }}>
              Downloading:{' '}
              {((fileDownloadState?.progress || 0) * 100).toFixed(2)}%
            </Text>
          ) : null}
        </View>
      )
    }

    // Only used for extension reading.
    const name = file.fileName?.toLowerCase() ?? ''

    if (fileType?.includes('image')) {
      return (
        <ImageViewer uri={status.cachedUri} style={styles.mediaWithPadding} />
      )
    }
    if (fileType?.includes('video')) {
      return (
        <VideoPlayer
          source={status.cachedUri}
          style={styles.mediaWithPadding}
        />
      )
    }
    if (fileType?.includes('audio')) {
      return (
        <AudioPlayer
          source={status.cachedUri}
          filename={file.fileName}
          style={styles.mediaWithPadding}
        />
      )
    }
    if (fileType?.includes('pdf') || name.endsWith('.pdf')) {
      return <PDFViewer source={status.cachedUri} style={styles.media} />
    }
    if (fileType?.includes('application/json') || name.endsWith('.json')) {
      return <JSONViewer uri={status.cachedUri} style={styles.media} />
    }
    if (
      fileType?.includes('text/markdown') ||
      name.endsWith('.md') ||
      name.endsWith('.markdown')
    ) {
      return <MarkdownViewer uri={status.cachedUri} style={styles.media} />
    }
    if (fileType?.includes('text/plain') || name.endsWith('.txt')) {
      return <TextViewer uri={status.cachedUri} style={styles.media} />
    }

    return (
      <View
        style={[
          styles.mediaWithPadding,
          { justifyContent: 'center', alignItems: 'center', gap: 10 },
        ]}
      >
        <FileIcon />
        <Text>Preview not available</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {header}
      <MediaDisplayComponent />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  mediaWithPadding: { flex: 1, marginBottom: 120 },
  media: { flex: 1 },
})
