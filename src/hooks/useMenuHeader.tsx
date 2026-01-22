import { palette } from '../styles/colors'
import { HomeIcon } from 'lucide-react-native'
import { useLayoutEffect } from 'react'
import { type MenuStackParamList } from '../stacks/types'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { IconButton } from '../components/IconButton'

export function useMenuHeader() {
  const navigation =
    useNavigation<
      NativeStackNavigationProp<MenuStackParamList, 'MenuHome'>
    >()
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton onPress={() => navigation.navigate('MainTab' as never)}>
          <HomeIcon color={palette.gray[50]} />
        </IconButton>
      ),
    })
  }, [navigation])
}
