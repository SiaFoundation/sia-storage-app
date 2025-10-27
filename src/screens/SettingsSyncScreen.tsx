import { StyleSheet } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsSyncPhotos } from '../components/SettingsSyncPhotos'
import { SettingsAdvancedSync } from '../components/SettingsAdvancedSync'
import { SettingsAdvancedTransfers } from '../components/SettingsAdvancedTransfers'
import { useShowAdvanced } from '../stores/settings'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Sync'>

export function SettingsSyncScreen(_props: Props) {
  useSettingsHeader()
  const showAdvanced = useShowAdvanced()

  return (
    <SettingsLayout style={styles.container}>
      <SettingsSyncPhotos />
      {showAdvanced.data ? (
        <>
          <SettingsAdvancedSync />
          <SettingsAdvancedTransfers />
        </>
      ) : null}
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
