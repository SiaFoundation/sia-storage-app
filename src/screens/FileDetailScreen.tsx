import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, StyleSheet, FlatList, useWindowDimensions } from 'react-native'
import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { FileActionsSheet } from '../components/FileActionsSheet'
import { palette } from '../styles/colors'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { FileViewer } from '../components/FileViewer'
import { FileDetailsControlBar } from '../components/FileDetailsControlBar'
import { type FileRecord } from '../stores/files'
import { useFileList } from '../stores/library'
import { useFlatListControls } from '../hooks/useFlatListControls'

type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'>

export function FileDetailScreen({ route, navigation }: Props) {
  const [viewStyle, setViewStyle] = useState<'consume' | 'detail'>('consume')
  const [activeFileID, setActiveFileID] = useState(route.params.id)
  const { data: fileList, size, setSize, isValidating, hasMore } = useFileList()
  const files = useMemo(() => fileList ?? [], [fileList])
  const { width } = useWindowDimensions()
  const flatListRef = useRef<FlatList<FileRecord>>(null)
  const initialTargetIndex = useMemo(
    () => files.findIndex((item) => item.id === route.params.id),
    [files, route.params.id]
  )
  const canPage = files.length > 0 && initialTargetIndex !== -1
  const initialIndex = initialTargetIndex === -1 ? 0 : initialTargetIndex
  const hasAlignedInitialIndex = useRef(false)
  const { handleEndReached } = useFlatListControls({
    data: fileList,
    size,
    setSize,
    isValidating,
    hasMore,
  })

  const file = useMemo(
    () => files.find((item) => item.id === activeFileID),
    [files, activeFileID]
  )

  useEffect(() => {
    setActiveFileID(route.params.id)
    hasAlignedInitialIndex.current = false
  }, [route.params.id])

  useEffect(() => {
    if (!canPage || hasAlignedInitialIndex.current) return
    const index = initialIndex
    requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToIndex({ index, animated: false })
      } catch (e) {
        // ignore until list is ready
      }
    })
    hasAlignedInitialIndex.current = true
  }, [canPage, initialIndex, route.params.id])

  const handleSetViewStyle = useCallback(
    (next: 'consume' | 'detail') => {
      if (next === viewStyle) return
      setViewStyle(next)
    },
    [viewStyle]
  )

  const handleMomentumEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      if (!files.length) return
      const index = Math.round(event.nativeEvent.contentOffset.x / width)
      const next = files[index]
      if (next && next.id !== activeFileID) {
        setActiveFileID(next.id)
      }
    },
    [files, width, activeFileID]
  )

  const renderFileItem = useCallback(
    ({ item }: { item: FileRecord }) => {
      const headerTitle = viewStyle === 'consume' ? 'View' : 'Details'
      const header = (
        <FileDetailScreenHeader
          file={item}
          title={item?.name ?? headerTitle}
          navigation={navigation}
        />
      )
      return (
        <View style={[styles.swipePage, { width }]}>
          {viewStyle === 'consume' ? (
            <FileViewer file={item} header={header} />
          ) : (
            <FileDetails file={item} header={header} />
          )}
        </View>
      )
    },
    [navigation, viewStyle, width]
  )

  return (
    <View style={styles.container}>
      {canPage && file ? (
        <FlatList
          ref={flatListRef}
          horizontal
          pagingEnabled
          data={files}
          renderItem={renderFileItem}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          onMomentumScrollEnd={handleMomentumEnd}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.7}
          windowSize={3}
          extraData={viewStyle}
        />
      ) : (
        file &&
        (viewStyle === 'consume' ? (
          <FileViewer
            file={file}
            header={
              <FileDetailScreenHeader
                file={file}
                title={file.name ?? 'View'}
                navigation={navigation}
              />
            }
          />
        ) : (
          <FileDetails
            file={file}
            header={
              <FileDetailScreenHeader
                file={file}
                title={file?.name ?? 'Details'}
                navigation={navigation}
              />
            }
          />
        ))
      )}
      <FileActionsSheet
        navigation={navigation}
        sheetName="fileActions"
        fileID={activeFileID}
      />
      <FileDetailsControlBar
        viewStyle={viewStyle}
        setViewStyle={handleSetViewStyle}
        fileID={activeFileID}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950], zIndex: 1 },
  swipePage: { flex: 1 },
})
