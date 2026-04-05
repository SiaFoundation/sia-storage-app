import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { useMenuHeader } from '../hooks/useMenuHeader'
import type { MenuStackParamList } from '../stacks/types'
import { colors, palette } from '../styles/colors'

type Props = NativeStackScreenProps<MenuStackParamList, 'MenuHome'>

type MenuSectionProps = {
  title: string
  children: React.ReactNode
}

function MenuSection({ title, children }: MenuSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionItems}>{children}</View>
    </View>
  )
}

type MenuItemProps = {
  label: string
  onPress: () => void
}

function MenuItem({ label, onPress }: MenuItemProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <View style={styles.rowItem}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowChevron}>›</Text>
      </View>
    </Pressable>
  )
}

export function MenuScreen({ navigation }: Props) {
  useMenuHeader()
  return (
    <SettingsScrollLayout>
      <MenuSection title="Settings">
        <MenuItem label="Indexer" onPress={() => navigation.navigate('Indexer')} />
        <MenuItem label="Sync" onPress={() => navigation.navigate('Sync')} />
        <MenuItem label="Hosts" onPress={() => navigation.navigate('Hosts')} />
        <MenuItem label="Advanced" onPress={() => navigation.navigate('Advanced')} />
        <MenuItem label="Logs" onPress={() => navigation.navigate('Logs')} />
      </MenuSection>

      <MenuSection title="Learn">
        <MenuItem
          label="Recovery Phrase"
          onPress={() => navigation.navigate('LearnRecoveryPhrase')}
        />
        <MenuItem
          label="How Storage Works"
          onPress={() => navigation.navigate('LearnHowItWorks')}
        />
        <MenuItem label="What is an Indexer?" onPress={() => navigation.navigate('LearnIndexer')} />
        <MenuItem label="The Sia Network" onPress={() => navigation.navigate('LearnSiaNetwork')} />
      </MenuSection>
    </SettingsScrollLayout>
  )
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: palette.gray[50],
    fontSize: 32,
    fontWeight: '800',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sectionItems: {},
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.bgPanel,
  },
  rowLabel: { flex: 1, color: palette.gray[100], fontSize: 16 },
  rowChevron: { color: palette.gray[300], fontSize: 18 },
})
