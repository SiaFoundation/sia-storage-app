import { View, StyleSheet, ScrollView } from 'react-native'
import { colors } from '../../styles/colors'
import { useFileStatus } from '../../lib/file'
import { FileMetaImport } from './FileMetaImport'
import { FileViewer } from '../FileViewer'
import { useDownloadFromShareURL } from '../../managers/downloader'
import {
  detailsShouldAutoDownload,
  useAutoDownloadFromShareURL,
} from '../../hooks/useAutoDownload'
import { FileRecord } from '../../stores/files'

export function FileDetailsImport({
  file,
  shareUrl,
}: {
  file: FileRecord
  shareUrl: string
}) {
  const status = useFileStatus(file)
  const handleDownload = useDownloadFromShareURL()

  // If the file is less than 4 MB, go ahead and download it to the user
  // device. We might look at a settings toggle for this or otherwise more
  // smartly do this depending on whether a user is on wifi, etc.
  useAutoDownloadFromShareURL(file, detailsShouldAutoDownload, shareUrl)

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
            fullscreen={false}
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
