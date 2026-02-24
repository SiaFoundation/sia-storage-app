import MapView, { type Region } from 'react-native-maps'

type Props = {
  children?: React.ReactNode
  region?: Region
}

export default function Map({
  children,
  region = {
    latitude: 45,
    longitude: -30,
    latitudeDelta: 120,
    longitudeDelta: 60,
  },
}: Props) {
  return (
    <MapView
      style={{ flex: 1 }}
      pitchEnabled={false}
      rotateEnabled={false}
      showsBuildings={false}
      showsCompass={false}
      showsIndoors={false}
      toolbarEnabled={false}
      zoomEnabled
      zoomControlEnabled
      zoomTapEnabled
      initialRegion={region}
    >
      {children}
    </MapView>
  )
}
