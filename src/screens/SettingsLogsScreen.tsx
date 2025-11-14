import { LogView } from '../components/LogView'
import { useLogs } from '../stores/logs'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsLogsControlBar } from '../components/SettingsLogsControlBar'
import { SettingsFullLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Logs'>

export function SettingsLogsScreen({ route, navigation }: Props) {
  const logs = useLogs()
  useSettingsHeader()

  return (
    <SettingsFullLayout>
      <LogView logs={logs} />
      <SettingsLogsControlBar navigation={navigation} route={route} />
    </SettingsFullLayout>
  )
}
