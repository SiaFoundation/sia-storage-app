import { StyleSheet, Platform } from 'react-native'
import MapView from 'react-native-maps'

export function FileMap() {
  return (
    <MapView
      style={styles.map}
      mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
      showsCompass={false}
      showsScale={false}
      showsIndoors={false}
      showsTraffic={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      scrollEnabled={false}
      toolbarEnabled={false}
    >
      {/* {file.slabs?.map((s) => (
        <Marker
          key={s.id}
          coordinate={{ latitude: s.latitude, longitude: s.longitude }}
        />
      ))} */}
    </MapView>
  )
}

const styles = StyleSheet.create({
  map: {
    width: '100%',
    height: '100%',
  },
})
