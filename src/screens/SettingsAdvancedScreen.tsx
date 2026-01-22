import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MenuStackParamList } from '../stacks/types'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { SettingsAdvancedAccount } from '../components/SettingsAdvancedAccount'
import { SettingsAdvancedDangerZone } from '../components/SettingsAdvancedDangerZone'
import { SettingsAdvancedInfo } from '../components/SettingsAdvancedInfo'
import { SettingsScrollLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<MenuStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(props: Props) {
  useMenuHeader()

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsAdvancedAccount />
      <SettingsAdvancedInfo {...props} />
      <SettingsAdvancedDangerZone />
    </SettingsScrollLayout>
  )
}
