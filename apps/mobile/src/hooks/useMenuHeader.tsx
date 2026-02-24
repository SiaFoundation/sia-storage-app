import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ArrowLeftIcon } from 'lucide-react-native'
import { useLayoutEffect } from 'react'
import { IconButton } from '../components/IconButton'
import type { MenuStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'

export function useMenuHeader() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MenuStackParamList, 'MenuHome'>>()
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <IconButton onPress={() => navigation.navigate('MainTab' as never)}>
          <ArrowLeftIcon color={palette.gray[50]} size={22} />
        </IconButton>
      ),
    })
  }, [navigation])
}
