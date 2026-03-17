import type { FileRecord } from '@siastorage/core/types'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useFileStatus } from '../../lib/file'
import { useDownloadFromShareURL } from '../../managers/downloader'
import { colors } from '../../styles/colors'
import { FileViewer } from '../FileViewer'
import { FileMetaImport } from './FileMetaImport'

export function FileDetailsImport({
  file,
  shareUrl,
}: {
  file: FileRecord
  shareUrl: string
}) {
  const status = useFileStatus(file, true)
  const handleDownload = useDownloadFromShareURL()

  return (
    <View style={styles.container}>
      <ScrollView>
        {/* There may be a more clever way to set this height.
            The big thorn here is images and video. We use a 'contain'
            resizing, which adds padding at the top and bottom.
            It matters less on video because those can be full screened.
            A smaller thorn is content that is less than 500 height.
            FileViewer has no intrinsic height, specifically so that
            it can be used wherever. */}
        <View style={{ height: 500 }}>
          <FileViewer
            file={file}
            isShared
            customDownloader={() => {
              handleDownload(file.id, shareUrl)
            }}
          />
        </View>
        {status.data ? (
          <FileMetaImport file={file} status={status.data} />
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
})
