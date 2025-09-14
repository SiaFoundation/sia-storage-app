import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { useHost } from '../stores/hosts'
import { determineBestRegion } from '../components/Map/mapHelpers'
import { useMemo } from 'react'
import { MapMarker } from '../components/Map/MapMarker'
import Map from '../components/Map/Map'
import { InfoCard } from '../components/InfoCard'
import { RowGroup } from '../components/Group'
import { LabeledValueRow } from '../components/LabeledValueRow'

type Props = NativeStackScreenProps<SettingsStackParamList, 'HostDetail'>

export function HostDetailScreen({ route }: Props) {
  const { publicKey } = route.params
  const host = useHost(publicKey)
  const region = useMemo(
    () => determineBestRegion(host.data ? [host.data] : []),
    [host.data]
  )
  if (!host.data) {
    if (host.isValidating) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color="#0ea5e9" />
        </View>
      )
    }
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Failed to load host.</Text>
      </View>
    )
  }
  return (
    <View style={styles.container}>
      <RowGroup title="Details">
        <InfoCard>
          <LabeledValueRow label="Public Key" value={publicKey} />
          <LabeledValueRow label="Country" value={host.data.countryCode} />
          <LabeledValueRow
            label="Addresses"
            value={host.data.addresses.map((a) => a.address).join(', ')}
          />
          <LabeledValueRow
            label="Location"
            value={`${host.data.latitude}, ${host.data.longitude}`}
          />
        </InfoCard>
      </RowGroup>
      <InfoCard style={{ height: 400 }}>
        <Map region={region}>
          <MapMarker
            size={10}
            key={publicKey}
            coordinate={{
              latitude: host.data.latitude,
              longitude: host.data.longitude,
            }}
            title={publicKey}
            description={host.data.countryCode}
          />
        </Map>
      </InfoCard>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8, backgroundColor: '#f6f8fa' },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  title: { color: '#24292f', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  meta: { color: '#57606a', fontSize: 12 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#24292f', fontSize: 16 },
})
