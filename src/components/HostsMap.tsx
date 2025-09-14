import { type Region } from 'react-native-maps'
import { useMemo } from 'react'
import Map from './Map/Map'
import { MapMarker } from './Map/MapMarker'
import { determineBestRegion } from './Map/mapHelpers'
import { useHosts } from '../stores/hosts'
import { SWROverlay } from './SWROverlay'

export default function HostsMap({
  onSelectHost,
}: {
  onSelectHost: (host: string) => void
}) {
  const hosts = useHosts()
  const region: Region | undefined = useMemo(() => {
    return determineBestRegion(hosts.data ?? [])
  }, [hosts])

  return (
    <SWROverlay
      response={hosts}
      errorMessage="Failed to load hosts"
      noDataMessage="No hosts yet"
    >
      <Map region={region}>
        {hosts.data?.map((h) => {
          return (
            <MapMarker
              size={10}
              key={h.publicKey}
              coordinate={{ latitude: h.latitude, longitude: h.longitude }}
              title={h.publicKey}
              description={h.countryCode}
              onPress={() => onSelectHost(h.publicKey)}
            />
          )
        })}
      </Map>
    </SWROverlay>
  )
}
