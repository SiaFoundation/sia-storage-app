import { View, StyleSheet, Pressable } from 'react-native'
import { ListIcon, MapIcon } from 'lucide-react-native'
import { HostsList } from '../components/HostsList'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from './SettingsHomeScreen'
import { useState, useLayoutEffect } from 'react'
import HostsMap from '../components/HostsMap'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Hosts'>

export default function HostsScreen({ navigation }: Props) {
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
              color={viewMode === 'list' ? '#24292f' : '#57606a'}
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
            <MapIcon
              size={16}
              color={viewMode === 'map' ? '#24292f' : '#57606a'}
            />
          </Pressable>
        </View>
      ),
    })
  }, [navigation, viewMode])

  const handleSelectHost = (publicKey: string) => {
    navigation.navigate('HostDetail', { publicKey })
  }

  return (
    <View style={styles.container}>
      {viewMode === 'list' ? (
        <HostsList onSelectHost={handleSelectHost} />
      ) : (
        <HostsMap onSelectHost={handleSelectHost} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toggleGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f8fa',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleActive: {
    backgroundColor: '#eaeef2',
  },
  togglePressed: {
    opacity: 0.7,
  },
})
