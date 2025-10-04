import { LogView } from '../components/LogView'
import { clearLogs, useLogs } from '../stores/logs'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { BottomControlBar, iconColors } from '../components/BottomControlBar'
import { TrashIcon } from 'lucide-react-native'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Logs'>

export function SettingsLogsScreen({ navigation }: Props) {
  const logs = useLogs()
  useSettingsHeader()
  return (
    <SettingsLayout>
      <LogView logs={logs} />
      <BottomControlBar
        width="dynamic"
        left={[
          {
            id: 'clear',
            label: 'Clear',
            icon: <TrashIcon size={22} color={iconColors.white} />,
            onPress: clearLogs,
          },
        ]}
      />
    </SettingsLayout>
  )
}
