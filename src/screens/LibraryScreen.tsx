import { useCallback, useRef, useState, type ComponentRef } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native'
import { colors, overlay, whiteA, palette } from '../styles/colors'
import { Gradient } from '../components/Gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Grid2X2Icon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react-native'
import { FileGallery } from '../components/FileGallery'
import { useNavigation } from '@react-navigation/native'
import { type NativeStackNavigationProp } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import {
  type FileRecord,
  useFileCount,
  useFileList,
  useFilesView,
  type Category,
} from '../stores/files'
import { FileList } from '../components/FileList'
import { FileSorter } from '../components/FileSorter'
import { FileFilter } from '../components/FileFilter'
import { useAppStatus } from '../hooks/useAppStatus'
import { BottomControlBar, iconColors } from '../components/BottomControlBar'
import { AddFileActionSheet } from '../components/AddFileActionSheet'
import { openSheet } from '../stores/sheets'
import { ExpandableBadge } from '../components/ExpandableBadge'

export function LibraryScreen() {
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery')
  const headerRef = useRef<ComponentRef<typeof View> | null>(null)
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>()
  const files = useFileList()
  const fileCount = useFileCount()
  const { selectedCategories } = useFilesView()
  const insets = useSafeAreaInsets()
  const appStatus = useAppStatus()
  const openAddMenu = useCallback(() => openSheet('addFile'), [])
  const handleOpenDetail = useCallback(
    (file: FileRecord) => {
      navigation.navigate('FileDetail', { id: file.id })
    },
    [navigation]
  )

  return (
    <View style={styles.container}>
      <Gradient
        fadeTo="bottom"
        overlayTopColor={overlay.gradientTop}
        overlayBottomColor={overlay.gradientBottom}
        style={styles.topBlur}
      />
      <View
        style={[
          styles.header,
          {
            position: 'absolute',
            top: insets.top - 4,
            left: 0,
            right: 0,
            zIndex: 10,
          },
        ]}
        pointerEvents="box-none"
        ref={headerRef}
      >
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitleLarge} pointerEvents="none">
            {(() => {
              const n = selectedCategories.size
              if (n === 1) {
                const only = Array.from(selectedCategories)[0] as Category
                switch (only) {
                  case 'Image':
                    return 'Photos'
                  case 'Video':
                    return 'Videos'
                  case 'Audio':
                    return 'Audio'
                  case 'Files':
                    return 'Files'
                  default:
                    return 'Library'
                }
              }
              return 'Library'
            })()}
          </Text>
          <Text style={styles.headerSubtitle}>
            {(() => {
              const total = fileCount.data ?? 0
              const filtered = files.data?.length ?? 0
              if (selectedCategories.size > 0) {
                return `${filtered} results`
              }
              return `${total} ${total === 1 ? 'item' : 'items'}`
            })()}
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <View style={styles.toggleGroup} pointerEvents="none">
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
                color={
                  viewMode === 'list' ? palette.gray[975] : palette.gray[300]
                }
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
                color={
                  viewMode === 'list' ? palette.gray[975] : palette.gray[300]
                }
              />
            </Pressable>
          </View>
          {appStatus.visible && (
            <View style={styles.statusPillContainer}>
              <ExpandableBadge
                label={appStatus.message}
                hint={appStatus.hint}
                size={12}
                interactive={true}
                backgroundColor={overlay.pill}
                borderColor={overlay.pill}
              >
                {appStatus.icon}
              </ExpandableBadge>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('SettingsTab' as never)}
            style={[styles.headerIcon, { paddingHorizontal: 4 }]}
          >
            <View style={styles.blurPillWrap}>
              <View style={styles.blurShade} />
              <SettingsIcon color={palette.gray[50]} size={16} />
            </View>
          </Pressable>
        </View>
      </View>
      {files.isLoading ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={palette.blue[400]} />
        </View>
      ) : !!fileCount.data ? (
        files.data && files.data.length > 0 ? (
          viewMode == 'gallery' ? (
            <FileGallery onPressItem={handleOpenDetail} topPadding={130} />
          ) : (
            <FileList onPressItem={handleOpenDetail} topPadding={130} />
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
      <AddFileActionSheet />
      <BottomControlBar
        center={{
          id: 'add',
          icon: <PlusIcon color={iconColors.white} size={24} />,
          onPress: openAddMenu,
        }}
        left={[
          {
            id: 'grid',
            icon: (
              <Grid2X2Icon
                size={18}
                color={
                  viewMode === 'gallery'
                    ? iconColors.active
                    : iconColors.inactive
                }
              />
            ),
            onPress: () => setViewMode('gallery'),
          },
          {
            id: 'list',
            icon: (
              <ListIcon
                size={18}
                color={
                  viewMode === 'list' ? iconColors.active : iconColors.inactive
                }
              />
            ),
            onPress: () => setViewMode('list'),
          },
        ]}
        right={[
          {
            id: 'filter',
            icon: (
              <View>
                <FileFilter />
              </View>
            ),
            onPress: () => {},
          },
          {
            id: 'sort',
            icon: (
              <View>
                <FileSorter />
              </View>
            ),
            onPress: () => {},
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgCanvas },
  header: {
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  topBlur: {
    zIndex: 10,
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 200,
  },
  headerTitleLarge: {
    color: palette.gray[50],
    fontSize: 32,
    fontWeight: '800',
  },
  headerTitles: { top: 0, flexDirection: 'column' },
  headerSubtitle: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  headerIcon: { paddingVertical: 6, paddingHorizontal: 8 },
  blurPillWrap: {
    position: 'relative',
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: overlay.pill,
  },
  statusPillContainer: {
    position: 'relative',
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
    flexDirection: 'row',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: overlay.pill,
  },
  statusPillText: {
    color: palette.gray[50],
    fontSize: 10,
    fontWeight: '600',
  },

  emptyImage: { width: 140, height: 140 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: palette.gray[100],
    fontWeight: '800',
    fontSize: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  emptyText: { color: whiteA.a70, textAlign: 'center' },

  buttonRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toggleGroup: { display: 'none' },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.light[100],
    borderColor: palette.gray[200],
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleActive: {
    backgroundColor: palette.light[200],
  },
  togglePressed: {
    opacity: 0.7,
  },
})
