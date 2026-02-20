import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SettingsAdvancedAccount } from '../components/SettingsAdvancedAccount'
import { SettingsAdvancedDangerZone } from '../components/SettingsAdvancedDangerZone'
import { SettingsAdvancedInfo } from '../components/SettingsAdvancedInfo'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import type { MenuStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<MenuStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(props: Props) {
  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsAdvancedAccount />
      <SettingsAdvancedInfo {...props} />
      <SettingsAdvancedDangerZone />
    </SettingsScrollLayout>
  )
}
