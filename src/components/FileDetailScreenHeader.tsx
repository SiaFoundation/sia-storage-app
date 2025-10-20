import React from 'react'
import { View, StyleSheet, Text, Pressable } from 'react-native'
import { type NavigationProp } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeftIcon, XIcon } from 'lucide-react-native'
import { overlay, palette } from '../styles/colors'
import { IconButton } from './IconButton'

type Props = {
  title: string
  navigation: NavigationProp<Record<string, object | undefined>>
  icon?: 'back' | 'close'
}

export function FileDetailScreenHeader({
  title,
  navigation,
  icon = 'back',
}: Props) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top + 2 }]}>
      <View style={styles.headerRow}>
        <IconButton onPress={() => navigation.goBack()}>
          {icon === 'back' ? (
            <ArrowLeftIcon color={palette.gray[50]} />
          ) : (
            <XIcon color={palette.gray[50]} />
          )}
        </IconButton>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        <View style={{ width: 36 }} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  headerContainer: { backgroundColor: palette.gray[950], paddingBottom: 8 },
  headerRow: {
    marginHorizontal: 10,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: palette.gray[50],
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  headerIcon: { paddingHorizontal: 4 },
  pill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: overlay.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
