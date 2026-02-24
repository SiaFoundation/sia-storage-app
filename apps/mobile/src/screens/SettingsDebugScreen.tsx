import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SettingsDebugHash } from '../components/SettingsDebugHash'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import type { MenuStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<MenuStackParamList, 'Debug'>

export function SettingsDebugScreen(_props: Props) {
  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsDebugHash />
    </SettingsScrollLayout>
  )
}
