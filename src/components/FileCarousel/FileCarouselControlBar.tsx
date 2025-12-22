import React from 'react'
import {
  MoreVerticalIcon,
  ShareIcon,
  LinkIcon,
  FullscreenIcon,
  TextAlignStart,
} from 'lucide-react-native'
import { iconColors } from '../BottomControlBar'
import { View, useWindowDimensions } from 'react-native'
import { IconButton } from '../IconButton'
import { BottomControlBar } from '../BottomControlBar'

type Props = {
  viewStyle: 'consume' | 'detail'
  setViewStyle: (viewStyle: 'consume' | 'detail') => void
  onShareFile: () => void
  onShareURL: () => void
  onPressMore: () => void
  canShare: boolean
}

/**
 * A control bar for the carousel overlay designed to work within a modal context.
 * All actions are passed as props from the parent to ensure toasts and sheets
 * render correctly above the modal.
 */
export function FileCarouselControlBar({
  viewStyle,
  setViewStyle,
  onShareFile,
  onShareURL,
  onPressMore,
  canShare,
}: Props) {
  const { width, height } = useWindowDimensions()
  const isLandscape = width > height
  const controlBarStyle = isLandscape
    ? ({ width: '80%', maxWidth: 420 } as const)
    : ({ width: '90%', maxWidth: 600 } as const)

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
          <IconButton onPress={onShareFile} disabled={!canShare}>
            <ShareIcon color={iconColors.white} />
          </IconButton>
          <IconButton onPress={onShareURL} disabled={!canShare}>
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
          <IconButton onPress={onPressMore}>
            <MoreVerticalIcon color={iconColors.white} />
          </IconButton>
        </View>
      </View>
    </BottomControlBar>
  )
}
