import React, { memo } from 'react'
import { View } from 'react-native'
import { Marker, type LatLng } from 'react-native-maps'

type DotMarkerProps = {
  coordinate: LatLng
  onPress?: () => void
  title?: string
  description?: string
  size?: number
  color?: string
  borderColor?: string
  borderWidth?: number
  zIndex?: number
  opacity?: number
}

export const MapMarker = memo(function DotMarker({
  coordinate,
  onPress,
  title,
  description,
  size = 10,
  color = 'red',
  borderColor = '#ffffff',
  borderWidth = 2,
  zIndex,
  opacity = 1,
}: DotMarkerProps) {
  const style = [
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      borderColor,
      borderWidth,
      opacity,
    },
  ]

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      tappable
      onPress={onPress}
      title={title}
      description={description}
      zIndex={zIndex}
    >
      <View style={style} />
    </Marker>
  )
})
