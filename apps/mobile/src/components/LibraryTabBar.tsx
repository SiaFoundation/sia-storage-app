import {
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
} from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Animated, type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native'
import type { ActiveLibraryTab } from '../stores/settings'
import { openSheet } from '../stores/sheets'
import { overlay, palette, whiteA } from '../styles/colors'
import { BottomControlBar, FloatingPill } from './BottomControlBar'
import { IconButton } from './IconButton'

type Props = {
  activeTab: ActiveLibraryTab
  onChangeTab: (tab: ActiveLibraryTab) => void
  onSearch: () => void
  onCreateDirectory: () => void
  onCreateTag: () => void
}

const INSET = 4
const TABS: ActiveLibraryTab[] = ['files', 'tags', 'media']

export function LibraryTabBar({
  activeTab,
  onChangeTab,
  onSearch,
  onCreateDirectory,
  onCreateTag,
}: Props) {
  const [totalWidth, setTotalWidth] = useState(0)
  const slideX = useRef(new Animated.Value(0)).current

  const segmentWidth = totalWidth > 0 ? (totalWidth - INSET * 2) / 3 : 0

  useEffect(() => {
    if (segmentWidth > 0) {
      const index = TABS.indexOf(activeTab)
      Animated.spring(slideX, {
        toValue: index * segmentWidth,
        useNativeDriver: true,
        tension: 300,
        friction: 30,
      }).start()
    }
  }, [activeTab, segmentWidth, slideX])

  const handleLayout = (e: LayoutChangeEvent) => {
    setTotalWidth(e.nativeEvent.layout.width)
  }

  const filesColor = activeTab === 'files' ? palette.gray[50] : whiteA.a50
  const tagsColor = activeTab === 'tags' ? palette.gray[50] : whiteA.a50
  const mediaColor = activeTab === 'media' ? palette.gray[50] : whiteA.a50

  return (
    <BottomControlBar variant="floating" style={styles.bar}>
      <View style={styles.segmentedControl} onLayout={handleLayout}>
        {segmentWidth > 0 ? (
          <Animated.View
            style={[
              styles.indicator,
              {
                width: segmentWidth,
                transform: [{ translateX: slideX }],
              },
            ]}
          />
        ) : null}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'files' }}
          onPress={() => onChangeTab('files')}
          style={styles.segment}
        >
          <FolderIcon size={20} color={filesColor} />
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'tags' }}
          onPress={() => onChangeTab('tags')}
          style={styles.segment}
        >
          <TagIcon size={20} color={tagsColor} />
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'media' }}
          onPress={() => onChangeTab('media')}
          style={styles.segment}
        >
          <ImageIcon size={20} color={mediaColor} />
        </Pressable>
      </View>
      <FloatingPill style={styles.actions}>
        {activeTab === 'files' ? (
          <>
            <IconButton onPress={onCreateDirectory} accessibilityLabel="Create folder">
              <FolderPlusIcon color={palette.gray[50]} size={20} />
            </IconButton>
            <IconButton onPress={onSearch} accessibilityLabel="Search">
              <SearchIcon color={palette.gray[50]} size={22} />
            </IconButton>
          </>
        ) : activeTab === 'tags' ? (
          <>
            <IconButton onPress={onCreateTag} accessibilityLabel="Create tag">
              <PlusIcon color={palette.gray[50]} size={20} />
            </IconButton>
            <IconButton onPress={onSearch} accessibilityLabel="Search">
              <SearchIcon color={palette.gray[50]} size={22} />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton onPress={() => openSheet('addFile')} accessibilityLabel="Add files">
              <FilePlusIcon color={palette.gray[50]} size={20} />
            </IconButton>
            <IconButton onPress={onSearch} accessibilityLabel="Search">
              <SearchIcon color={palette.gray[50]} size={22} />
            </IconButton>
          </>
        )}
      </FloatingPill>
    </BottomControlBar>
  )
}

const styles = StyleSheet.create({
  bar: {
    width: '90%',
    maxWidth: 600,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  segmentedControl: {
    height: 56,
    borderRadius: 26,
    backgroundColor: overlay.panelStrong,
    flexDirection: 'row',
    alignItems: 'center',
    padding: INSET,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    borderColor: whiteA.a08,
    borderWidth: StyleSheet.hairlineWidth,
  },
  indicator: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    borderRadius: 22,
    backgroundColor: whiteA.a10,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: '100%',
    zIndex: 1,
  },
  actions: {
    gap: 2,
  },
})
