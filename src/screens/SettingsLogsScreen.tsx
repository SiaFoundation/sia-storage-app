import { LogView } from '../components/LogView'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsLogsControlBar } from '../components/SettingsLogsControlBar'
import { SettingsFullLayout } from '../components/SettingsLayout'
import { logsSwr } from '../hooks/useLogs'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Logs'>

export function SettingsLogsScreen({ route, navigation }: Props) {
  useSettingsHeader()

  const handleRefresh = async () => {
    await logsSwr.triggerChange()
  }

  return (
    <SettingsFullLayout>
      <LogView />
      <SettingsLogsControlBar
        navigation={navigation}
        route={route}
        onRefresh={handleRefresh}
      />
    </SettingsFullLayout>
  )
}
