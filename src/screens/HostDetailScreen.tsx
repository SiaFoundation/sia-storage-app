import { Text, StyleSheet, ActivityIndicator, View } from 'react-native'
import { colors, palette } from '../styles/colors'
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
import { SettingsLayout } from '../components/SettingsLayout'

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
          <ActivityIndicator color={palette.blue[400]} />
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
    <SettingsLayout style={styles.container}>
      <RowGroup title="Info">
        <InfoCard>
          <LabeledValueRow label="Public Key" value={publicKey} />
          <LabeledValueRow
            label="Addresses"
            value={host.data.addresses.map((a) => a.address).join(', ')}
          />
        </InfoCard>
      </RowGroup>
      <RowGroup title="Location">
        <InfoCard style={{ height: 400 }}>
          <LabeledValueRow label="Country" value={host.data.countryCode} />
          <LabeledValueRow
            label="Location"
            value={`${host.data.latitude}, ${host.data.longitude}`}
          />
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
      </RowGroup>
    </SettingsLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 24,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.borderMutedLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  title: {
    color: palette.gray[975],
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  meta: { color: palette.gray[300], fontSize: 12 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: palette.gray[100], fontSize: 16 },
})
