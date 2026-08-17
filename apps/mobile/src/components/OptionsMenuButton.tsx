/**
 * The cog in the top-right corner of every screen that renders before the app
 * proper: onboarding and the splash. Those screens have no tab bar and no
 * settings menu, so without it a user who lands in a state the screen can't
 * resolve on its own - a sign-in the indexer rejects, a sync that never
 * finishes - has nowhere to go but deleting the app. On iOS that doesn't even
 * help: app keys are kept in the keychain, which survives app deletion.
 *
 * The menu holds whichever resets apply: there is nothing to sign out of or
 * resync from before onboarding, so that case collapses to one action and has
 * room for the custom indexer entry the welcome screen adds.
 */
import { SettingsIcon } from 'lucide-react-native'
import { Alert, type AlertButton, Pressable, StyleSheet } from 'react-native'
import {
  promptClearAndResync,
  promptClearAndSignOut,
  promptClearLocalData,
} from '../lib/resetPrompts'
import { app } from '../stores/appService'
import { palette } from '../styles/colors'

type Props = {
  /** Distance from the top of the screen, normally the safe-area inset plus padding. */
  top: number
  /** Adds a "Use a custom indexer" entry, shown only before onboarding. */
  onCustomIndexer?: () => void
  testID?: string
}

export function OptionsMenuButton({ top, onCustomIndexer, testID }: Props) {
  // useHasOnboarded reads undefined while the splash is up, which would offer
  // the sign-out reset to someone who is signed in.
  //
  // Android renders at most three alert buttons and drops the rest, so each
  // branch adds two actions and Cancel makes the third.
  const showMenu = async () => {
    const hasOnboarded = await app().settings.getHasOnboarded()
    const buttons: AlertButton[] = []
    if (hasOnboarded) {
      buttons.push({ text: 'Clear local data and resync', onPress: promptClearAndResync })
      buttons.push({
        text: 'Clear local data and sign out',
        style: 'destructive',
        onPress: promptClearAndSignOut,
      })
    } else {
      if (onCustomIndexer) {
        buttons.push({ text: 'Use a custom indexer', onPress: onCustomIndexer })
      }
      buttons.push({
        text: 'Clear local data',
        style: 'destructive',
        onPress: promptClearLocalData,
      })
    }
    buttons.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert('Options', undefined, buttons)
  }

  return (
    <Pressable
      testID={testID ?? 'options-menu-button'}
      onPress={() => void showMenu()}
      style={[styles.button, { top }]}
      accessibilityRole="button"
      accessibilityLabel="Options"
    >
      <SettingsIcon color={palette.gray[400]} size={20} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
    padding: 4,
  },
})
