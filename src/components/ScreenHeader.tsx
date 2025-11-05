import React from 'react'
import { View, StyleSheet, type ViewStyle, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type Props = {
  children: React.ReactNode
  style?: ViewStyle
  position?: 'absolute' | 'relative'
  zIndex?: number
  topOffset?: number
  paddingHorizontal?: number
}

export function ScreenHeader({
  children,
  style,
  position = 'absolute',
  zIndex = 10,
}: Props) {
  const insets = useSafeAreaInsets()
  const topOffset = Platform.OS === 'ios' && Platform.isPad ? 8 : 0
  const paddingHorizontal = Platform.OS === 'ios' && Platform.isPad ? 18 : 16
  return (
    <View
      style={[
        styles.container,
        {
          position,
          top: insets.top + topOffset,
          zIndex,
          paddingHorizontal,
        },
        style,
      ]}
      pointerEvents="box-none"
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
})
