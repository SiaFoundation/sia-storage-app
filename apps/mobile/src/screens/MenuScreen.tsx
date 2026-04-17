import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { DEFAULT_INDEXER_URL } from '@siastorage/core/config'
import { useIndexerURL } from '@siastorage/core/stores'
import type React from 'react'
import { useCallback } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { openExternalURL } from '../lib/inAppBrowser'
import type { MenuStackParamList } from '../stacks/types'
import { colors, palette } from '../styles/colors'

const SIA_STORAGE_HOST = 'sia.storage'
const SIA_STORAGE_DELETE_URL = 'https://sia.storage/dashboard/account'
const SIA_STORAGE_SUPPORT_URL = 'https://sia.storage/resources/support'
const SIA_STORAGE_REPORT_URL = 'https://sia.storage/resources/report'
const SIA_STORAGE_TERMS_URL = 'https://sia.storage/resources/terms'
const SIA_STORAGE_PRIVACY_URL = 'https://sia.storage/resources/privacy'

function isSiaStorageIndexer(indexerURL: string): boolean {
  try {
    return new URL(indexerURL).hostname === SIA_STORAGE_HOST
  } catch {
    return false
  }
}

function promptDeleteAccount(indexerURL: string) {
  const isSiaStorage = isSiaStorageIndexer(indexerURL)
  const targetURL = isSiaStorage ? SIA_STORAGE_DELETE_URL : indexerURL
  const message = isSiaStorage
    ? 'Your Sia Storage account is managed on the sia.storage website. Tap Continue to sign in and permanently delete your account and all data stored with Sia Storage.'
    : `Your account is managed by your indexer at ${indexerURL}. Tap Continue to sign in and permanently delete your account and all your data.`

  Alert.alert('Delete Account', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Continue to Website', onPress: () => void openExternalURL(targetURL) },
  ])
}

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
  const indexerURL = useIndexerURL()
  const handleDeleteAccount = useCallback(() => {
    promptDeleteAccount(indexerURL.data ?? DEFAULT_INDEXER_URL)
  }, [indexerURL.data])
  return (
    <SettingsScrollLayout>
      <MenuSection title="Settings">
        <MenuItem label="Indexer" onPress={() => navigation.navigate('Indexer')} />
        <MenuItem label="Sync" onPress={() => navigation.navigate('Sync')} />
        <MenuItem label="Import" onPress={() => navigation.navigate('Import')} />
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

      <MenuSection title="Help">
        <MenuItem label="Support" onPress={() => void openExternalURL(SIA_STORAGE_SUPPORT_URL)} />
        <MenuItem
          label="Report Content"
          onPress={() => void openExternalURL(SIA_STORAGE_REPORT_URL)}
        />
        <MenuItem
          label="Terms of Service"
          onPress={() => void openExternalURL(SIA_STORAGE_TERMS_URL)}
        />
        <MenuItem
          label="Privacy Policy"
          onPress={() => void openExternalURL(SIA_STORAGE_PRIVACY_URL)}
        />
      </MenuSection>

      <MenuSection title="Account">
        <MenuItem label="Delete Account" onPress={handleDeleteAccount} />
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
