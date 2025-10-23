import React, { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import useSWR from 'swr'
import { AddressProtocol, Host } from 'react-native-sia'
import { DEFAULT_INDEXER_URL } from '../../config'
import { type FileRecord } from '../../stores/files'
import { useHosts } from '../../stores/hosts'
import { useSdk } from '../../stores/sdk'
import Map from '../Map/Map'
import { MapMarker } from '../Map/MapMarker'
import { determineBestRegion } from '../Map/mapHelpers'
import { SWROverlay } from '../SWROverlay'

export function FileMap({ file }: { file: FileRecord }) {
  const sdk = useSdk()
  const hosts = useHosts()

  const firstSlabID = useMemo(() => {
    const slabs = file.objects[DEFAULT_INDEXER_URL]?.slabs ?? []
    return slabs[0]?.id
  }, [file])

  const slab = useSWR(
    sdk && firstSlabID ? ['sdk/slab', firstSlabID] : null,
    () => sdk?.slab(firstSlabID!)
  )

  const matchingHosts: Host[] = useMemo(() => {
    if (!hosts.data || !slab.data) return []
    const keys = new Set(
      (slab.data.sectors ?? []).map((sec: any) => sec.hostKey)
    )
    return hosts.data.filter((h) => keys.has(h.publicKey))
  }, [hosts.data, slab.data])

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
                  ? h.addresses.find(
                      (a) => a.protocol === AddressProtocol.SiaMux
                    )?.address ?? h.publicKey
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
