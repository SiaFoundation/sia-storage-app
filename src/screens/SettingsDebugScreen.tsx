import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MenuStackParamList } from '../stacks/types'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { SettingsDebugHash } from '../components/SettingsDebugHash'
import { SettingsScrollLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<MenuStackParamList, 'Debug'>

export function SettingsDebugScreen(_props: Props) {
  useMenuHeader()

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsDebugHash />
    </SettingsScrollLayout>
  )
}
