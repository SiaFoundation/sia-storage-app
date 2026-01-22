import { LogView } from '../components/LogView'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MenuStackParamList } from '../stacks/types'
import { useMenuHeader } from '../hooks/useMenuHeader'
import { SettingsLogsControlBar } from '../components/SettingsLogsControlBar'
import { SettingsFullLayout } from '../components/SettingsLayout'
import { logsSwr } from '../hooks/useLogs'

type Props = NativeStackScreenProps<MenuStackParamList, 'Logs'>

export function SettingsLogsScreen({ route, navigation }: Props) {
  useMenuHeader()

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
