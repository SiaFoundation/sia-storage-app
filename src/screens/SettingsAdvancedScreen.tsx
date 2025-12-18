import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsAdvancedAccount } from '../components/SettingsAdvancedAccount'
import { SettingsAdvancedDangerZone } from '../components/SettingsAdvancedDangerZone'
import { SettingsAdvancedInfo } from '../components/SettingsAdvancedInfo'
import { SettingsScrollLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(props: Props) {
  useSettingsHeader()

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsAdvancedAccount />
      <SettingsAdvancedInfo {...props} />
      <SettingsAdvancedDangerZone />
    </SettingsScrollLayout>
  )
}
