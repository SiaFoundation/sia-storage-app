import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { DEFAULT_INDEXER_URL } from '@siastorage/core/config'
import { useIndexerURL } from '@siastorage/core/stores'
import { useCallback } from 'react'
import { Alert } from 'react-native'
import { InsetGroupLink, InsetGroupSection } from '../components/InsetGroup'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { openExternalURL } from '../lib/inAppBrowser'
import type { MenuStackParamList } from '../stacks/types'

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

export function MenuScreen({ navigation }: Props) {
  useMenuHeader()
  const indexerURL = useIndexerURL()
  const handleDeleteAccount = useCallback(() => {
    promptDeleteAccount(indexerURL.data ?? DEFAULT_INDEXER_URL)
  }, [indexerURL.data])
  return (
    <SettingsScrollLayout>
      <InsetGroupSection header="Settings">
        <InsetGroupLink label="Indexer" onPress={() => navigation.navigate('Indexer')} />
        <InsetGroupLink label="Sync" onPress={() => navigation.navigate('Sync')} />
        <InsetGroupLink label="Import" onPress={() => navigation.navigate('Import')} />
        <InsetGroupLink label="Advanced" onPress={() => navigation.navigate('Advanced')} />
        <InsetGroupLink label="Logs" onPress={() => navigation.navigate('Logs')} />
      </InsetGroupSection>

      <InsetGroupSection header="Learn">
        <InsetGroupLink
          label="Recovery Phrase"
          onPress={() => navigation.navigate('LearnRecoveryPhrase')}
        />
        <InsetGroupLink
          label="How Storage Works"
          onPress={() => navigation.navigate('LearnHowItWorks')}
        />
        <InsetGroupLink
          label="What is an Indexer?"
          onPress={() => navigation.navigate('LearnIndexer')}
        />
        <InsetGroupLink
          label="The Sia Network"
          onPress={() => navigation.navigate('LearnSiaNetwork')}
        />
      </InsetGroupSection>

      <InsetGroupSection header="Help">
        <InsetGroupLink
          label="Support"
          onPress={() => void openExternalURL(SIA_STORAGE_SUPPORT_URL)}
        />
        <InsetGroupLink
          label="Report Content"
          onPress={() => void openExternalURL(SIA_STORAGE_REPORT_URL)}
        />
        <InsetGroupLink
          label="Terms of Service"
          onPress={() => void openExternalURL(SIA_STORAGE_TERMS_URL)}
        />
        <InsetGroupLink
          label="Privacy Policy"
          onPress={() => void openExternalURL(SIA_STORAGE_PRIVACY_URL)}
        />
      </InsetGroupSection>

      <InsetGroupSection header="Account">
        <InsetGroupLink label="Delete Account" destructive onPress={handleDeleteAccount} />
      </InsetGroupSection>
    </SettingsScrollLayout>
  )
}
