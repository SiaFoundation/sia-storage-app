import React from 'react'
import { View, StyleSheet, Text, Pressable } from 'react-native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeftIcon } from 'lucide-react-native'
import { colors, overlay, palette, whiteA } from '../styles/colors'

type Props = {
  title: string
  navigation: NativeStackNavigationProp<MainStackParamList>
}

export function FileDetailScreenHeader({ title, navigation }: Props) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top + 2 }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={styles.headerIcon}
        >
          <View style={styles.pill}>
            <ArrowLeftIcon color={palette.gray[50]} size={16} />
          </View>
        </Pressable>
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
