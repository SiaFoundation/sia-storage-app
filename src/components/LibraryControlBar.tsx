import React, { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import {
  Grid2X2Icon,
  ListIcon,
  PlusIcon,
  ListChecksIcon,
  XIcon,
  MoreVerticalIcon,
} from 'lucide-react-native'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { FileSearchButton } from './FileSearchButton'
import { FileSearchBar } from './FileSearchBar'
import { toggleLibraryViewMode, useLibraryViewMode } from '../stores/settings'
import { openSheet } from '../stores/sheets'
import { IconButton } from './IconButton'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { MainStackParamList } from '../stacks/types'
import { LibraryControlsSearchMenus } from './LibraryControlsSearchMenus'
import {
  useIsSelectionMode,
  useSelectedCount,
  enterSelectionMode,
  exitSelectionMode,
} from '../stores/fileSelection'
import { palette } from '../styles/colors'

type Props = NativeStackScreenProps<MainStackParamList, 'LibraryHome'> & {
  onOpenSelectionActions?: () => void
}

export function LibraryControlBar({
  route,
  navigation,
  onOpenSelectionActions,
}: Props) {
  const viewMode = useLibraryViewMode()
  const [searchActive, setSearchActive] = useState(false)
  const isSelectionMode = useIsSelectionMode()
  const selectedCount = useSelectedCount()

  if (isSelectionMode) {
    return (
      <BottomControlBar
        keyboardAware
        style={{ width: '90%', maxWidth: 600 }}
      >
        <View style={styles.selectionContainer}>
          <IconButton onPress={exitSelectionMode}>
            <XIcon color={iconColors.white} />
          </IconButton>
          <Text style={styles.selectionCount}>
            {selectedCount} selected
          </Text>
          <IconButton
            onPress={onOpenSelectionActions}
            disabled={selectedCount === 0}
          >
            <MoreVerticalIcon
              color={selectedCount > 0 ? iconColors.white : iconColors.inactive}
            />
          </IconButton>
        </View>
      </BottomControlBar>
    )
  }

  return (
    <BottomControlBar
      keyboardAware
      style={{ width: '90%', maxWidth: 600 }}
      controlsTop={searchActive ? <LibraryControlsSearchMenus /> : null}
    >
      {searchActive ? (
        <FileSearchBar onExit={() => setSearchActive(false)} />
      ) : (
        <View style={styles.normalContainer}>
          <IconButton onPress={toggleLibraryViewMode}>
            {viewMode.data === 'list' ? (
              <Grid2X2Icon color={iconColors.white} />
            ) : (
              <ListIcon color={iconColors.white} />
            )}
          </IconButton>
          <IconButton onPress={enterSelectionMode}>
            <ListChecksIcon color={iconColors.white} />
          </IconButton>
          <IconButton onPress={() => openSheet('addFile')}>
            <PlusIcon color={iconColors.white} />
          </IconButton>
          <FileSearchButton onOpen={() => setSearchActive((s) => !s)} />
        </View>
      )}
    </BottomControlBar>
  )
}

const styles = StyleSheet.create({
  normalContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectionContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectionCount: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
  },
})
