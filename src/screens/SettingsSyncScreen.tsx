import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MenuStackParamList } from '../stacks/types'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { SettingsSyncPhotos } from '../components/SettingsSyncPhotos'
import { SettingsAdvancedSync } from '../components/SettingsAdvancedSync'
import { SettingsAdvancedTransfers } from '../components/SettingsAdvancedTransfers'
import { useShowAdvanced } from '../stores/settings'
import { SettingsScrollLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<MenuStackParamList, 'Sync'>

export function SettingsSyncScreen(_props: Props) {
  useMenuHeader()
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
