import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SettingsAdvancedSync } from '../components/SettingsAdvancedSync'
import { SettingsAdvancedTransfers } from '../components/SettingsAdvancedTransfers'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { SettingsSyncPhotos } from '../components/SettingsSyncPhotos'
import type { MenuStackParamList } from '../stacks/types'
import { useShowAdvanced } from '../stores/settings'

type Props = NativeStackScreenProps<MenuStackParamList, 'Sync'>

export function SettingsSyncScreen(_props: Props) {
  const showAdvanced = useShowAdvanced()

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsSyncPhotos />
      {showAdvanced.data ? (
        <>
          <SettingsAdvancedSync />
          <SettingsAdvancedTransfers />
        </>
      ) : null}
    </SettingsScrollLayout>
  )
}
