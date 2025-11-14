import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsDebugHash } from '../components/SettingsDebugHash'
import { SettingsScrollLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Debug'>

export function SettingsDebugScreen(_props: Props) {
  useSettingsHeader()

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
      <SettingsDebugHash />
    </SettingsScrollLayout>
  )
}
