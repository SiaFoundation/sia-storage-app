import { useCallback, useRef, useState, type ComponentRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Grid2X2Icon, ListIcon, PlusIcon } from 'lucide-react-native'
import { Gallery } from '../components/Gallery'
import { useNavigation } from '@react-navigation/native'
import { type NativeStackNavigationProp } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { type FileRecord, useFileList } from '../stores/files'
import { FileList } from '../components/FileList'
import { usePickAndUpload } from '../hooks/usePickAndUpload'

export function FileListScreen() {
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery')
  const headerRef = useRef<ComponentRef<typeof View> | null>(null)
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>()
  const { data: files } = useFileList()

  const pickAndUpload = usePickAndUpload()

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
            onPress={pickAndUpload}
            style={styles.headerIcon}
          >
            <PlusIcon color="#0969da" size={22} />
          </Pressable>
        </View>
      </View>
      {(files?.length ?? 0) === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No uploads yet</Text>
          <Text style={styles.emptyText}>
            Tap the plus to upload media from your library.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={pickAndUpload}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Upload media</Text>
          </Pressable>
        </View>
      ) : viewMode == 'gallery' ? (
        <Gallery onPressItem={handleOpenDetail} />
      ) : (
        <FileList onPressItem={handleOpenDetail} />
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
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#24292f', fontSize: 16, fontWeight: '600' },
  headerIcon: { paddingVertical: 6, paddingHorizontal: 8 },
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
})
