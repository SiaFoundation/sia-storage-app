import {
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native'
import { colors } from '../styles/colors'

type Props = {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}

export function SettingsScrollLayout({ children, style }: Props) {
  return (
    <ScrollView style={[styles.container]}>
      <View style={[styles.content, style]}>{children}</View>
    </ScrollView>
  )
}

export function SettingsFullLayout({ children, style }: Props) {
  return (
    <View style={[styles.container, { height: '100%' }, style]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgCanvas,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    paddingTop: 24,
    paddingBottom: 64,
  },
})
