import { Alert } from 'react-native'
import { resetLocalDataAndResync, resetLocalDataAndSignOut } from '../managers/app'

export function promptClearAndResync() {
  Alert.alert(
    'Clear local data and resync',
    'Rebuilds your library from your indexer. Any files still importing or uploading will be lost. Your account stays signed in.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear and resync',
        style: 'destructive',
        onPress: () => void resetLocalDataAndResync(),
      },
    ],
  )
}

export function promptClearAndSignOut() {
  Alert.alert(
    'Clear local data and sign out',
    'Wipes your local library and signs you out. Any files still importing or uploading will be lost. You will need your recovery phrase to sign back in.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear and sign out',
        style: 'destructive',
        onPress: () => void resetLocalDataAndSignOut(),
      },
    ],
  )
}

/**
 * Pre-onboarding equivalent: there's no indexer to resync from and no
 * account to sign out of, so both keep variants collapse to a single
 * "clear everything and start over" action. Uses the sign-out path
 * (keepAuth=false) so nothing carries over into a fresh onboarding.
 */
export function promptClearLocalData() {
  Alert.alert(
    'Clear local data',
    'Wipes any local data and starts over. You will return to the welcome screen.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => void resetLocalDataAndSignOut(),
      },
    ],
  )
}
