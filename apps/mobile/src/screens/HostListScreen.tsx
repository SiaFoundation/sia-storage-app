import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ListIcon, MapIcon } from 'lucide-react-native'
import { useLayoutEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { HostsList } from '../components/HostsList'
import HostsMap from '../components/HostsMap'
import { SettingsFullLayout } from '../components/SettingsLayout'
import type { MenuStackParamList } from '../stacks/types'
import { colors, palette } from '../styles/colors'

type Props = NativeStackScreenProps<MenuStackParamList, 'Hosts'>

export function HostListScreen({ navigation }: Props) {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.toggleGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show list"
            onPress={() => setViewMode('list')}
            style={({ pressed }) => [
              styles.toggleButton,
              viewMode === 'list' && styles.toggleActive,
              pressed && styles.togglePressed,
            ]}
          >
            <ListIcon
              size={16}
              color={viewMode === 'list' ? palette.gray[50] : palette.gray[700]}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show map"
            onPress={() => setViewMode('map')}
            style={({ pressed }) => [
              styles.toggleButton,
              viewMode === 'map' && styles.toggleActive,
              pressed && styles.togglePressed,
            ]}
          >
            <MapIcon size={16} color={viewMode === 'map' ? palette.gray[50] : palette.gray[700]} />
          </Pressable>
        </View>
      ),
    })
  }, [navigation, viewMode])

  const handleSelectHost = (publicKey: string) => {
    navigation.navigate('HostDetail', { publicKey })
  }

  return (
    <SettingsFullLayout>
      {viewMode === 'list' ? (
        <HostsList onSelectHost={handleSelectHost} />
      ) : (
        <HostsMap onSelectHost={handleSelectHost} />
      )}
    </SettingsFullLayout>
  )
}

const styles = StyleSheet.create({
  toggleGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPanel,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleActive: {
    backgroundColor: colors.bgPanel,
    color: palette.gray[50],
  },
  togglePressed: {
    opacity: 0.7,
  },
})
