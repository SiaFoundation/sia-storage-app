import { AddressProtocol, type Host } from '@siastorage/core/adapters'
import type { Slab } from '@siastorage/core/types'
import { useHosts } from '@siastorage/core/stores'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import useSWR from 'swr'
import { app } from '../../stores/appService'
import Map from '../Map/Map'
import { MapMarker } from '../Map/MapMarker'
import { determineBestRegion } from '../Map/mapHelpers'
import { SWROverlay } from '../SWROverlay'

export function FileMap({ fileId }: { fileId: string }) {
  const hosts = useHosts()

  const { data: firstSlab } = useSWR<Slab | null>(['fileMap:firstSlab', fileId], async () => {
    const objects = await app().localObjects.getForFileWithSlabs(fileId)
    return objects[0]?.slabs[0] ?? null
  })

  const matchingHosts: Host[] = useMemo(() => {
    if (!hosts.data || !firstSlab) return []
    const keys = new Set(firstSlab.sectors.map((sec) => sec.hostKey))
    return hosts.data.filter((h) => keys.has(h.publicKey))
  }, [hosts.data, firstSlab])

  const region = useMemo(() => {
    if (matchingHosts.length === 0) return undefined
    return determineBestRegion(matchingHosts)
  }, [matchingHosts])

  return (
    <View style={styles.container}>
      <SWROverlay
        response={hosts}
        errorMessage="Failed to load hosts"
        noDataMessage="No hosts available"
      >
        <Map region={region}>
          {matchingHosts.map((h) => (
            <MapMarker
              size={10}
              key={h.publicKey}
              coordinate={{ latitude: h.latitude, longitude: h.longitude }}
              title={
                hosts.data
                  ? (h.addresses.find((a) => a.protocol === AddressProtocol.SiaMux)?.address ??
                    h.publicKey)
                  : h.publicKey
              }
            />
          ))}
        </Map>
      </SWROverlay>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
})
