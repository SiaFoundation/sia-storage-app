import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { LogView } from '../components/LogView'
import { SettingsFullLayout } from '../components/SettingsLayout'
import { SettingsLogsControlBar } from '../components/SettingsLogsControlBar'
import { logsSwr } from '../hooks/useLogs'
import { useMenuHeader } from '../hooks/useMenuHeader'
import type { MenuStackParamList } from '../stacks/types'

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
