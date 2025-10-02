import { useCallback, useRef, useState, type ComponentRef } from 'react'
import { View, Text, Pressable, StyleSheet, Image } from 'react-native'
import {
  Grid2X2Icon,
  ListIcon,
  PlusIcon,
  ImageIcon,
  CameraIcon,
  FileIcon,
} from 'lucide-react-native'
import { Gallery } from '../components/Gallery'
import { useNavigation } from '@react-navigation/native'
import { type NativeStackNavigationProp } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { type FileRecord, useFileCount, useFileList } from '../stores/files'
import { FileList } from '../components/FileList'
import { useImagePickerAndUpload } from '../hooks/useImagePicker'
import { useCameraCaptureAndUpload } from '../hooks/useCameraCapture'
import { useDocumentPickerAndUpload } from '../hooks/useDocumentPicker'
import { Menu, MenuItem } from '../components/Menu'
import { FileSorter } from '../components/FileSorter'
import { FileFilter } from '../components/FileFilter'

export function FileListScreen() {
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery')
  const headerRef = useRef<ComponentRef<typeof View> | null>(null)
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>()
  const files = useFileList()
  const fileCount = useFileCount()

  const imagePickerAndUpload = useImagePickerAndUpload()
  const captureAndUpload = useCameraCaptureAndUpload()
  const documentPickerAndUpload = useDocumentPickerAndUpload()

  const [isAddMenuOpen, setIsAddMenuOpen] = useState<boolean>(false)
  const addButtonRef = useRef<View>(null)
  const openAddMenu = useCallback(() => setIsAddMenuOpen(true), [])
  const closeAddMenu = useCallback(() => setIsAddMenuOpen(false), [])
  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      action()
      setIsAddMenuOpen(false)
    },
    []
  )

  const handleOpenDetail = useCallback(
    (file: FileRecord) => {
      navigation.navigate('FileDetail', { id: file.id })
    },
    [navigation]
  )

  return (
    <View style={styles.container}>
      <View style={styles.header} ref={headerRef}>
        <Text style={styles.headerTitle}>Home</Text>
        <View style={styles.buttonRow}>
          <View style={styles.toggleGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show gallery view"
              onPress={() => setViewMode('gallery')}
              style={({ pressed }) => [
                styles.toggleButton,
                viewMode === 'gallery' && styles.toggleActive,
                pressed && styles.togglePressed,
              ]}
            >
              <Grid2X2Icon
                size={16}
                color={viewMode === 'list' ? '#24292f' : '#57606a'}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show list view"
              onPress={() => setViewMode('list')}
              style={({ pressed }) => [
                styles.toggleButton,
                viewMode === 'list' && styles.toggleActive,
                pressed && styles.togglePressed,
              ]}
            >
              <ListIcon
                size={16}
                color={viewMode === 'list' ? '#24292f' : '#57606a'}
              />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={openAddMenu}
            style={styles.headerIcon}
            ref={addButtonRef}
          >
            <PlusIcon color="#0969da" size={22} />
          </Pressable>
        </View>
      </View>
      {!!fileCount.data && fileCount.data > 1 && (
        <View style={styles.sortFilterRow}>
          <FileFilter />
          <FileSorter />
        </View>
      )}
      {!!fileCount.data ? (
        files.data && files.data.length > 0 ? (
          viewMode == 'gallery' ? (
            <Gallery onPressItem={handleOpenDetail} />
          ) : (
            <FileList onPressItem={handleOpenDetail} />
          )
        ) : (
          <View style={styles.emptyWrap}>
            <Image
              style={styles.emptyImage}
              source={require('../../assets/image-stack.png')}
            />
            <Text style={styles.emptyTitle}>No files found</Text>
            <Text style={styles.emptyText}>
              No files matching the selected filters.
            </Text>
          </View>
        )
      ) : (
        <View style={styles.emptyWrap}>
          <Image
            style={styles.emptyImage}
            source={require('../../assets/image-stack.png')}
          />
          <Text style={styles.emptyTitle}>Add files to get started</Text>
          <Text style={styles.emptyText}>
            Files are sharded and encrypted and synced directly to the Sia host
            network.
          </Text>
        </View>
      )}
      <Menu
        isOpen={isAddMenuOpen}
        onClose={closeAddMenu}
        anchorRef={addButtonRef}
        contentStyle={{ right: 8, top: 52 }}
      >
        <MenuItem
          icon={<CameraIcon color="#ffffff" size={18} />}
          onPress={handlePressAndClose(captureAndUpload)}
        >
          Take Photo or Video
        </MenuItem>
        <MenuItem
          icon={<ImageIcon color="#ffffff" size={18} />}
          onPress={handlePressAndClose(imagePickerAndUpload)}
        >
          Choose from Photos
        </MenuItem>
        <MenuItem
          icon={<FileIcon color="#ffffff" size={18} />}
          onPress={handlePressAndClose(documentPickerAndUpload)}
        >
          Import from Files
        </MenuItem>
      </Menu>
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
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#24292f', fontSize: 16, fontWeight: '600' },
  headerIcon: { paddingVertical: 6, paddingHorizontal: 8 },
  emptyImage: { width: 140, height: 140 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    paddingTop: '35%',
    padding: 24,
  },
  emptyTitle: {
    color: '#24292f',
    fontWeight: '700',
    fontSize: 16,
    paddingBottom: 8,
  },
  emptyText: { color: '#57606a', textAlign: 'center', marginBottom: 8 },
  primaryButton: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
  buttonRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toggleGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f8fa',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleActive: {
    backgroundColor: '#eaeef2',
  },
  togglePressed: {
    opacity: 0.7,
  },
  sortFilterRow: {
    display: 'flex',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'flex-end',
    padding: 8,
    backgroundColor: '#f2f2f2',
  },
})
