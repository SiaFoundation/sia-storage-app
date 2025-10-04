import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors } from '../styles/colors'

type Props = {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}

export function SettingsLayout({ children, style }: Props) {
  return <View style={[styles.container, style]}>{children}</View>
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgCanvas,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: '100%',
  },
})
