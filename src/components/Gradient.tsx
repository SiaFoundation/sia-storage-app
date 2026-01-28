import { LinearGradient } from 'expo-linear-gradient'
import { type ColorValue, StyleSheet, View, type ViewProps } from 'react-native'

type Props = ViewProps & {
  fadeTo?: 'top' | 'bottom'
  overlayTopColor?: string
  overlayBottomColor?: string
}

export function Gradient({
  fadeTo = 'bottom',
  overlayTopColor = 'rgba(16,18,21,0.66)',
  overlayBottomColor = 'rgba(16,18,21,0)',
  style,
  ...rest
}: Props) {
  return (
    <View style={[{ zIndex: 10, pointerEvents: 'none' }, style]} {...rest}>
      <LinearGradient
        colors={
          (fadeTo === 'bottom'
            ? [overlayTopColor, overlayBottomColor]
            : [overlayBottomColor, overlayTopColor]) as [ColorValue, ColorValue]
        }
        start={{ x: 0.5, y: fadeTo === 'bottom' ? 0 : 1 }}
        end={{ x: 0.5, y: fadeTo === 'bottom' ? 1 : 0 }}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  )
}
