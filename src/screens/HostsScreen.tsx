import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import MapView, { Marker, type Region } from 'react-native-maps'
import useSWR from 'swr'
import { ListIcon, MapIcon } from 'lucide-react-native'
import { Hosts } from '../components/Hosts'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from './SettingsHomeScreen'
import { useMemo, useState, useLayoutEffect } from 'react'
import { useSettings } from '../lib/settingsContext'
import { type Host } from 'react-native-sia'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Hosts'>

export default function HostsScreen({ navigation }: Props) {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const { sdk } = useSettings()
  const {
    data: hosts,
    error,
    isLoading,
  } = useSWR<Host[]>(viewMode === 'map' ? ['hosts', sdk] : null, async () =>
    sdk.hosts()
  )

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

  const region: Region | undefined = useMemo(() => {
    if (!hosts || hosts.length === 0) return undefined
    let minLat = hosts[0]?.latitude ?? 0
    let maxLat = hosts[0]?.latitude ?? 0
    let minLng = hosts[0]?.longitude ?? 0
    let maxLng = hosts[0]?.longitude ?? 0
    for (const h of hosts) {
      const lat = h?.latitude ?? 0
      const lng = h?.longitude ?? 0
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
      minLng = Math.min(minLng, lng)
      maxLng = Math.max(maxLng, lng)
    }
    const latDelta = Math.max(2, (maxLat - minLat) * 1.5)
    const lngDelta = Math.max(2, (maxLng - minLng) * 1.5)
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    }
  }, [hosts])

  return (
    <View style={styles.flex1}>
      {viewMode === 'list' ? (
        <Hosts
          hideHeader
          onSelectHost={(host) => navigation.navigate('HostDetail', { host })}
        />
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Failed to load hosts.</Text>
        </View>
      ) : isLoading || !hosts ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#0ea5e9" />
        </View>
      ) : (
        <MapView
          style={styles.flex1}
          initialRegion={
            region ?? {
              latitude: 0,
              longitude: 0,
              latitudeDelta: 80,
              longitudeDelta: 180,
            }
          }
        >
          {hosts.map((h) => (
            <Marker
              key={h.publicKey}
              coordinate={{ latitude: h.latitude, longitude: h.longitude }}
              title={h.publicKey}
              description={h.countryCode}
              onCalloutPress={() =>
                navigation.navigate('HostDetail', { host: h.publicKey })
              }
            />
          ))}
        </MapView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
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
  loading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  errorText: {
    color: '#cf222e',
    fontSize: 12,
  },
})
