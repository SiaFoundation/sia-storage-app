import PhotoDetail from '../components/PhotoDetail'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type FeedStackParamList } from '../navigation/types'
import { useCallback, useLayoutEffect } from 'react'
import { Share2Icon } from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'

type Props = NativeStackScreenProps<FeedStackParamList, 'PhotoDetail'>

function HeaderShareButton({ onPress }: { onPress: () => void }) {
  return <Share2Icon color="#0969da" size={20} onPress={onPress} />
}

function createHeaderRight(onPress: () => void) {
  return () => <HeaderShareButton onPress={onPress} />
}

export default function PhotoDetailScreen({ route, navigation }: Props) {
  const { item } = route.params
  const toast = useToast()

  const handleShare = useCallback(() => {
    Clipboard.setString(item.id)
    toast.show('Copied photo id')
  }, [item.id, toast])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: createHeaderRight(handleShare),
    })
  }, [navigation, handleShare])

  return <PhotoDetail item={item} />
}
