import React from 'react'
import {
  MoreVerticalIcon,
  ShareIcon,
  LinkIcon,
  FullscreenIcon,
  TextAlignStart,
  Icon,
} from 'lucide-react-native'
import { iconColors } from './BottomControlBar'
import { openSheet } from '../stores/sheets'
import { useShareAction } from '../hooks/useShareAction'
import { View, useWindowDimensions } from 'react-native'
import { IconButton } from './IconButton'
import { BottomControlBar } from './BottomControlBar'

type Props = {
  viewStyle: 'consume' | 'detail'
  setViewStyle: (viewStyle: 'consume' | 'detail') => void
  fileID: string
}

export function FileDetailsControlBar({
  viewStyle,
  setViewStyle,
  fileID,
}: Props) {
  const { handleShareFile, handleShareURL, canShare } = useShareAction({
    fileId: fileID,
  })
  const { width, height } = useWindowDimensions()
  const isLandscape = width > height
  const controlBarStyle = isLandscape
    ? { width: '80%', maxWidth: 420 }
    : { width: '90%', maxWidth: 600 }

  return (
    <BottomControlBar style={controlBarStyle}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <IconButton onPress={handleShareFile} disabled={!canShare}>
            <ShareIcon color={iconColors.white} />
          </IconButton>
          <IconButton onPress={handleShareURL} disabled={!canShare}>
            <LinkIcon color={iconColors.white} />
          </IconButton>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {viewStyle === 'consume' ? (
            <IconButton onPress={() => setViewStyle('detail')}>
              <TextAlignStart color={iconColors.white} />
            </IconButton>
          ) : (
            <IconButton onPress={() => setViewStyle('consume')}>
              <FullscreenIcon color={iconColors.white} />
            </IconButton>
          )}
          <IconButton onPress={() => openSheet('fileActions')}>
            <MoreVerticalIcon color={iconColors.white} />
          </IconButton>
        </View>
      </View>
    </BottomControlBar>
  )
}
