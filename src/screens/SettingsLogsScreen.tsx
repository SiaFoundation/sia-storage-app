import { LogView } from '../components/LogView'
import { useLogs } from '../stores/logs'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsLogsControlBar } from '../components/SettingsLogsControlBar'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Logs'>

export function SettingsLogsScreen({ route, navigation }: Props) {
  const logs = useLogs()
  useSettingsHeader()

  return (
    <SettingsLayout>
      <LogView logs={logs} />
      <SettingsLogsControlBar navigation={navigation} route={route} />
    </SettingsLayout>
  )
}
