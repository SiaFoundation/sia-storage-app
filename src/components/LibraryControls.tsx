import React, { useState } from 'react'
import { View, Text } from 'react-native'
import { Grid2X2Icon, ListIcon } from 'lucide-react-native'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { FileSearchControl } from './FileSearchControl'
import { FileSearchBar } from './FileSearchBar'
import { palette } from '../styles/colors'
import { toggleLibraryViewMode, useLibraryViewMode } from '../stores/settings'
import { openSheet } from '../stores/sheets'
import { IconButton } from './IconButton'
import { LibraryControlsSearchMenus } from './LibraryControlsSearchMenus'

export function LibraryControls() {
  const viewMode = useLibraryViewMode()
  const [searchActive, setSearchActive] = useState(false)

  return (
    <BottomControlBar
      keyboardAware
      overlayTop={searchActive ? <LibraryControlsSearchMenus /> : null}
      content={
        searchActive ? (
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
              {viewMode.data === 'gallery' ? (
                <Grid2X2Icon size={18} color={iconColors.active} />
              ) : (
                <ListIcon size={18} color={iconColors.active} />
              )}
            </IconButton>
            <IconButton onPress={() => openSheet('addFile')}>
              <Text style={{ color: palette.gray[50], fontSize: 22 }}>+</Text>
            </IconButton>
            <FileSearchControl onOpen={() => setSearchActive((s) => !s)} />
          </View>
        )
      }
    />
  )
}
