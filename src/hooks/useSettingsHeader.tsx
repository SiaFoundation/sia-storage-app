import { View, StyleSheet, Pressable } from 'react-native'
import { palette } from '../styles/colors'
import { HomeIcon } from 'lucide-react-native'
import { useLayoutEffect } from 'react'
import { type SettingsStackParamList } from '../stacks/types'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>

export function useSettingsHeader() {
  const navigation =
    useNavigation<
      NativeStackNavigationProp<SettingsStackParamList, 'SettingsHome'>
    >()
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('MainTab' as never)}
          style={[styles.headerIcon, { paddingHorizontal: 4 }]}
        >
          <View style={styles.blurPillWrap}>
            <HomeIcon color={palette.gray[50]} size={16} />
          </View>
        </Pressable>
      ),
    })
  }, [navigation])
}

const styles = StyleSheet.create({
  headerIcon: { paddingVertical: 6, paddingHorizontal: 8 },
  blurPillWrap: {
    position: 'relative',
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
