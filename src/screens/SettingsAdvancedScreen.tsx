import { StyleSheet } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { SettingsRecoveryPhrase } from '../components/SettingsRecoveryPhrase'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsAdvancedAccount } from '../components/SettingsAdvancedAccount'
import { SettingsAdvancedDangerZone } from '../components/SettingsAdvancedDangerZone'
import { SettingsAdvancedInfo } from '../components/SettingsAdvancedInfo'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(_props: Props) {
  useSettingsHeader()

  return (
    <SettingsLayout style={styles.container}>
      <SettingsAdvancedAccount />
      <SettingsRecoveryPhrase />
      <SettingsAdvancedInfo />
      <SettingsAdvancedDangerZone />
    </SettingsLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 24,
  },
})
