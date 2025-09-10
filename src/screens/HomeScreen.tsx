import { useCallback, useRef, type ComponentRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { PlusIcon } from 'lucide-react-native'
import { pickAndUploadImages, UploadedItem } from '../Upload'
import {
  useAllUploadStates as useUploadStatusMap,
  setUploadState,
} from '../lib/uploadState'
import { Gallery } from '../components/Gallery'
import { useSettings } from '../lib/settingsContext'
import { useNavigation } from '@react-navigation/native'
import { type NativeStackNavigationProp } from '@react-navigation/native-stack'
import { type FeedStackParamList } from '../navigation/types'
import { useFiles, useFileList } from '../lib/filesContext'
import { type FileRecord } from '../db/files'

export default function HomeScreen() {
  const headerRef = useRef<ComponentRef<typeof View> | null>(null)
  const { sdk, log } = useSettings()
  const navigation =
    useNavigation<NativeStackNavigationProp<FeedStackParamList>>()
  const { createFile } = useFiles()
  const uploadStatusMap = useUploadStatusMap()
  const { data: files } = useFileList()

  const handleUpload = useCallback(async () => {
    if (!sdk) return
    try {
      pickAndUploadImages({
        sdk,
        log,
        onPicked: (temps) => {
          void Promise.all(
            temps.map((t) =>
              createFile({
                id: t.id,
                uri: t.uri,
                fileName: t.fileName,
                fileSize: t.fileSize,
                createdAt: t.createdAt,
                status: 'done',
                metadata: null,
              })
            )
          )
          temps.forEach((t) =>
            setUploadState(t.id, { status: 'uploading', progress: 0 })
          )
        },
        onProgress: () => {},
      })
    } catch (e) {
      log(`Upload flow error: ${String(e)}`)
    }
  }, [sdk, log, createFile])

  const handleOpenDetail = useCallback(
    (record: FileRecord) => {
      const r = uploadStatusMap[record.id]
      const status: UploadedItem['status'] = r?.status ?? 'done'
      const item: UploadedItem = {
        id: record.id,
        uri: record.uri,
        fileName: record.fileName,
        fileSize: record.fileSize,
        createdAt: record.createdAt,
        status,
        progress: r?.progress ?? (status === 'done' ? 1 : 0),
      }
      navigation.navigate('PhotoDetail', { item })
    },
    [navigation, uploadStatusMap]
  )

  return (
    <View style={styles.container}>
      <View style={styles.header} ref={headerRef}>
        <Text style={styles.headerTitle}>Home</Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleUpload}
          style={styles.headerIcon}
        >
          <PlusIcon color="#0969da" size={22} />
        </Pressable>
      </View>
      {(files?.length ?? 0) === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No uploads yet</Text>
          <Text style={styles.emptyText}>
            Tap the plus to upload a photo from your library.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleUpload}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Upload photo</Text>
          </Pressable>
        </View>
      ) : (
        <Gallery onPressItem={handleOpenDetail} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 44,
    paddingHorizontal: 16,
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    flexDirection: 'row',
  },
  headerTitle: { color: '#24292f', fontSize: 16, fontWeight: '600' },
  headerIcon: { marginLeft: 'auto', paddingVertical: 6, paddingHorizontal: 8 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  emptyTitle: { color: '#24292f', fontWeight: '700' },
  emptyText: { color: '#57606a', textAlign: 'center', marginBottom: 8 },
  primaryButton: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
})
