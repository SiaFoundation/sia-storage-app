import { StyleSheet } from 'react-native'
import { palette } from '../styles/colors'
import { HomeIcon } from 'lucide-react-native'
import { useLayoutEffect } from 'react'
import { type SettingsStackParamList } from '../stacks/types'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { IconButton } from '../components/IconButton'

export function useSettingsHeader() {
  const navigation =
    useNavigation<
      NativeStackNavigationProp<SettingsStackParamList, 'SettingsHome'>
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

const styles = StyleSheet.create({
  headerIcon: { paddingVertical: 6, paddingHorizontal: 8 },
})
