import type React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { palette, whiteA } from '../styles/colors'

type Props = {
  title: string
  subtitle: string
  icon: React.ReactElement
}

export function ScreenHeaderTitle({ title, subtitle, icon }: Props) {
  return (
    <>
      {icon}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  text: {
    flex: 1,
  },
  title: {
    color: palette.gray[50],
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: whiteA.a50,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
})
