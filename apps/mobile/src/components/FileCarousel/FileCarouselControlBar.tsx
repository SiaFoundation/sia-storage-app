import {
  FolderIcon,
  FullscreenIcon,
  HeartIcon,
  MoreVerticalIcon,
  ShareIcon,
  TagIcon,
  TextAlignStart,
} from 'lucide-react-native'
import { useWindowDimensions, View } from 'react-native'
import { palette } from '../../styles/colors'
import { BottomControlBar, iconColors } from '../BottomControlBar'
import { IconButton } from '../IconButton'

type Props = {
  viewStyle: 'consume' | 'detail'
  setViewStyle: (viewStyle: 'consume' | 'detail') => void
  onShareFile: () => void
  onAddTag: () => void
  onMoveToDirectory: () => void
  onPressMore: () => void
  onToggleFavorite: () => void
  isFavorite: boolean
  canShare: boolean
}

export function FileCarouselControlBar({
  viewStyle,
  setViewStyle,
  onShareFile,
  onAddTag,
  onMoveToDirectory,
  onPressMore,
  onToggleFavorite,
  isFavorite,
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
          <IconButton
            onPress={onToggleFavorite}
            accessibilityLabel={isFavorite ? 'Unfavorite' : 'Favorite'}
          >
            <HeartIcon
              color={isFavorite ? palette.red[500] : iconColors.white}
              fill={isFavorite ? palette.red[500] : 'none'}
            />
          </IconButton>
          <IconButton onPress={onShareFile} disabled={!canShare}>
            <ShareIcon color={iconColors.white} />
          </IconButton>
          <IconButton onPress={onAddTag} accessibilityLabel="Add tag">
            <TagIcon color={iconColors.white} />
          </IconButton>
          <IconButton
            onPress={onMoveToDirectory}
            accessibilityLabel="Move to folder"
          >
            <FolderIcon color={iconColors.white} />
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
