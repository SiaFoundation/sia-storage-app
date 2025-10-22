import React, { useState } from 'react'
import { View } from 'react-native'
import { Grid2X2Icon, ListIcon, PlusIcon } from 'lucide-react-native'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { FileSearchButton } from './FileSearchButton'
import { FileSearchBar } from './FileSearchBar'
import { toggleLibraryViewMode, useLibraryViewMode } from '../stores/settings'
import { openSheet } from '../stores/sheets'
import { IconButton } from './IconButton'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { MainStackParamList } from '../stacks/types'
import { LibraryControlsSearchMenus } from './LibraryControlsSearchMenus'

type Props = NativeStackScreenProps<MainStackParamList, 'LibraryHome'>

export function LibraryControlBar({ route, navigation }: Props) {
  const viewMode = useLibraryViewMode()
  const [searchActive, setSearchActive] = useState(false)

  return (
    <BottomControlBar
      keyboardAware
      style={{ width: '90%', maxWidth: 600 }}
      overlayTop={searchActive ? <LibraryControlsSearchMenus /> : null}
    >
      {searchActive ? (
        <FileSearchBar onExit={() => setSearchActive(false)} />
      ) : (
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <IconButton onPress={toggleLibraryViewMode}>
            {viewMode.data === 'list' ? (
              <Grid2X2Icon color={iconColors.white} />
            ) : (
              <ListIcon color={iconColors.white} />
            )}
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
