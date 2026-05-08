import type { InitStep } from '@siastorage/core/app'
import { useHasOnboarded } from '@siastorage/core/stores'
import { Alert, Platform, StyleSheet, Text, View } from 'react-native'
import { LINKS } from '../config/links'
import { openExternalURL } from '../lib/inAppBrowser'
import {
  promptClearAndResync,
  promptClearAndSignOut,
  promptClearLocalData,
} from '../lib/resetPrompts'
import { palette } from '../styles/colors'
import { InsetGroupLink, InsetGroupSection } from './InsetGroup'

const RESTART_INSTRUCTIONS =
  Platform.OS === 'ios'
    ? 'Swipe up from the bottom of the screen and pause, then swipe up on the Sia Storage card to close it. Open Sia Storage again from your home screen.'
    : 'Open the recent apps view, swipe the Sia Storage card away, then tap the app icon to open it again.'

function promptRestart() {
  Alert.alert('How to restart Sia Storage', RESTART_INSTRUCTIONS, [{ text: 'Got it' }])
}

// Linking.openURL rejects when the user cancels the iOS "Open in Mail?" prompt,
// or when no mail app is configured. Either way, nothing to do.
function emailSupport() {
  openExternalURL(`mailto:${LINKS.supportEmail}`).catch(() => {})
}

export function AppSplashError({ step }: { step: InitStep }) {
  const hasOnboarded = useHasOnboarded()

  return (
    <View style={styles.errorWrap}>
      <View style={styles.card}>
        <View style={styles.cardContent}>
          <View style={styles.headerBlock}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            {/* Cap at 4 lines so a verbose error can't push the recovery
                actions off-screen. */}
            <Text style={styles.errorMessage} numberOfLines={4} ellipsizeMode="tail">
              {step.message}
            </Text>
          </View>

          <InsetGroupSection footer="Closing and reopening Sia Storage may fix your issue.">
            <InsetGroupLink label="Close and restart" onPress={promptRestart} showChevron={false} />
          </InsetGroupSection>

          {hasOnboarded ? (
            <InsetGroupSection footer="If restarting doesn't help, try clearing and re-syncing your local data.">
              <InsetGroupLink
                label="Clear local data and resync"
                onPress={promptClearAndResync}
                showChevron={false}
              />
            </InsetGroupSection>
          ) : (
            <InsetGroupSection footer="If restarting doesn't help, try clearing your local data.">
              <InsetGroupLink
                label="Clear local data"
                onPress={promptClearLocalData}
                destructive
                showChevron={false}
              />
            </InsetGroupSection>
          )}

          <InsetGroupSection footer="If neither of those help, let us know what error you're running into.">
            <InsetGroupLink label="Email the team" onPress={emailSupport} showChevron={false} />
          </InsetGroupSection>

          {hasOnboarded ? (
            // Visually separated from the recovery actions above — not part
            // of the "try this to fix it" flow, just available if the user
            // wants to sign out at the same time as wiping data.
            <>
              <View style={styles.signOutDivider} />
              {/* Pull up to neutralize part of InsetGroupSection's default
                  marginBottom — keeps the bottom of the card snug under the
                  sign-out button. */}
              <View style={styles.signOutSection}>
                <InsetGroupSection>
                  <InsetGroupLink
                    label="Clear local data and sign out"
                    onPress={promptClearAndSignOut}
                    destructive
                    showChevron={false}
                  />
                </InsetGroupSection>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Negative horizontal margin extends the card past the parent splash's
  // 20px paddingHorizontal so the band runs edge-to-edge like the
  // onboarding welcome screen.
  errorWrap: {
    alignSelf: 'stretch',
    marginHorizontal: -20,
  },
  card: {
    width: '100%',
    paddingTop: 32,
    paddingBottom: 4,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.gray[800],
  },
  // Caps content width so InsetGroup rows don't stretch into uselessly long
  // bars on tablets / large devices. The card band stays full-bleed.
  cardContent: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  headerBlock: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  errorTitle: {
    color: 'white',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  errorMessage: {
    color: palette.gray[200],
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
  },
  signOutDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.gray[800],
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  signOutSection: {
    marginBottom: -8,
  },
})
