import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useShowAdvanced } from '@siastorage/core/stores'
import { Switch } from 'react-native'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { SettingsAdvancedSync } from '../components/SettingsAdvancedSync'
import { SettingsAdvancedTransfers } from '../components/SettingsAdvancedTransfers'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { SettingsSyncPhotos } from '../components/SettingsSyncPhotos'
import type { MenuStackParamList } from '../stacks/types'
import { toggleKeepAwake, useKeepAwake } from '../stores/settings'

type Props = NativeStackScreenProps<MenuStackParamList, 'Sync'>

export function SettingsSyncScreen(_props: Props) {
  const showAdvanced = useShowAdvanced()
  const keepAwake = useKeepAwake()

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsSyncPhotos />
      <InfoCard>
        <LabeledValueRow
          label="Stay awake"
          description="Prevents the screen from turning off while the app is open."
          labelWidth={250}
          canCopy={false}
          value={<Switch value={keepAwake.data ?? false} onValueChange={toggleKeepAwake} />}
        />
      </InfoCard>
      {showAdvanced.data ? (
        <>
          <SettingsAdvancedSync />
          <SettingsAdvancedTransfers />
        </>
      ) : null}
    </SettingsScrollLayout>
  )
}
