import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { DEFAULT_INDEXER_URL } from '@siastorage/core/config'
import { useAccount, useIndexerURL } from '@siastorage/core/stores'
import { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import {
  InsetGroupCopyRow,
  InsetGroupLink,
  InsetGroupSection,
  InsetGroupToggleRow,
  InsetGroupValueRow,
} from '../components/InsetGroup'
import { navigateToImports } from '../lib/navigationRef'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { SettingsSyncPhotos } from '../components/SettingsSyncPhotos'
import { LINKS } from '../config/links'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { openExternalURL } from '../lib/inAppBrowser'
import { promptClearAndResync, promptClearAndSignOut } from '../lib/resetPrompts'
import { useToast } from '../lib/toastContext'
import type { MenuStackParamList } from '../stacks/types'
import { reconnectIndexer, useIsConnected } from '../stores/sdk'
import { toggleKeepAwake, useKeepAwake } from '../stores/settings'

const SIA_STORAGE_HOST = 'sia.storage'

function isSiaStorageIndexer(indexerURL: string): boolean {
  try {
    return new URL(indexerURL).hostname === SIA_STORAGE_HOST
  } catch {
    return false
  }
}

function promptDeleteAccount(indexerURL: string) {
  const isSiaStorage = isSiaStorageIndexer(indexerURL)
  const targetURL = isSiaStorage ? LINKS.deleteAccountDashboard : indexerURL
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
  const toast = useToast()
  const indexerURL = useIndexerURL()
  const isConnected = useIsConnected()
  const account = useAccount()
  const keepAwake = useKeepAwake()
  const [isReconnecting, setIsReconnecting] = useState(false)

  const handleDeleteAccount = useCallback(() => {
    promptDeleteAccount(indexerURL.data ?? DEFAULT_INDEXER_URL)
  }, [indexerURL.data])

  const handleReconnect = useCallback(async () => {
    setIsReconnecting(true)
    const success = await reconnectIndexer()
    setIsReconnecting(false)
    toast.show(success ? 'Reconnected' : 'Failed to reconnect')
  }, [toast])

  return (
    <SettingsScrollLayout>
      <SettingsSyncPhotos />

      <InsetGroupSection header="Library">
        <InsetGroupLink label="Imports" onPress={navigateToImports} />
      </InsetGroupSection>

      <InsetGroupSection header="Device">
        <InsetGroupToggleRow
          label="Stay awake during uploads"
          value={keepAwake.data ?? false}
          onValueChange={toggleKeepAwake}
        />
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

      <InsetGroupSection header="Community">
        <InsetGroupLink
          label="Website"
          onPress={() => void openExternalURL(LINKS.website)}
          showChevron={false}
        />
        <InsetGroupLink
          label="Discord"
          onPress={() => void openExternalURL(LINKS.discord)}
          showChevron={false}
        />
        <InsetGroupLink
          label="X"
          onPress={() => void openExternalURL(LINKS.x)}
          showChevron={false}
        />
        <InsetGroupLink
          label="GitHub"
          onPress={() => void openExternalURL(LINKS.github)}
          showChevron={false}
        />
        <InsetGroupLink
          label="Support"
          onPress={() => void openExternalURL(`mailto:${LINKS.supportEmail}`)}
          showChevron={false}
        />
      </InsetGroupSection>

      <InsetGroupSection header="Legal">
        <InsetGroupLink
          label="Terms of Service"
          onPress={() => void openExternalURL(LINKS.terms)}
          showChevron={false}
        />
        <InsetGroupLink
          label="Privacy Policy"
          onPress={() => void openExternalURL(LINKS.privacy)}
          showChevron={false}
        />
        <InsetGroupLink
          label="Report Content"
          onPress={() => void openExternalURL(LINKS.reportContent)}
          showChevron={false}
        />
      </InsetGroupSection>

      <InsetGroupSection header="Indexer">
        <InsetGroupValueRow label="Status" value={isConnected ? 'Connected' : 'Offline'} />
        <InsetGroupValueRow label="URL" value={indexerURL.data ?? ''} />
        {account.data ? (
          <InsetGroupCopyRow label="Account key" value={account.data.accountKey} />
        ) : null}
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label={isReconnecting ? 'Reconnecting…' : 'Reconnect'}
          description="Disconnect and reconnect to the current indexer."
          onPress={handleReconnect}
          showChevron={false}
        />
        <InsetGroupLink
          label="Switch indexers"
          description="Sign into a different indexer with the same recovery phrase."
          onPress={() => navigation.navigate('SwitchIndexer')}
          showChevron={false}
        />
      </InsetGroupSection>

      <InsetGroupSection header="Developers">
        <InsetGroupLink label="Developers" onPress={() => navigation.navigate('Advanced')} />
      </InsetGroupSection>

      <InsetGroupSection header="Danger zone">
        <InsetGroupLink
          label="Clear local data and resync"
          description="Rebuilds your library from your indexer. Pending uploads are lost. You stay signed in."
          destructive
          onPress={promptClearAndResync}
          showChevron={false}
        />
        <InsetGroupLink
          label="Clear local data and sign out"
          description="Signs you out and clears your library. Pending uploads are lost. You'll need your recovery phrase to sign back in."
          destructive
          onPress={promptClearAndSignOut}
          showChevron={false}
        />
        <InsetGroupLink
          label="Delete account"
          description="Permanently deletes your indexer account and all storage data."
          destructive
          onPress={handleDeleteAccount}
          showChevron={false}
        />
      </InsetGroupSection>
    </SettingsScrollLayout>
  )
}
