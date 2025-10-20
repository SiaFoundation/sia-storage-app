import {
  clearLogs,
  toggleEnableSdkLogs,
  useSDKLogsEnabled,
} from '../stores/logs'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { iconColors } from './BottomControlBar'
import { EyeIcon, EyeOffIcon, TrashIcon } from 'lucide-react-native'
import { View } from 'react-native'
import { IconButton } from './IconButton'
import { useToast } from '../lib/toastContext'
import { BottomControlBar } from './BottomControlBar'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Logs'>

export function SettingsLogsControlBar({ navigation }: Props) {
  const sdkLogsEnabled = useSDKLogsEnabled()
  const toast = useToast()

  const handleToggleSdkLogs = () => {
    toggleEnableSdkLogs()
    toast.show(sdkLogsEnabled ? 'SDK logs disabled' : 'SDK logs enabled')
  }

  const handleClearLogs = () => {
    clearLogs()
    toast.show('Logs cleared')
  }

  return (
    <BottomControlBar style={{ width: 300, maxWidth: '90%' }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <IconButton onPress={handleToggleSdkLogs}>
          {sdkLogsEnabled ? (
            <EyeIcon color={iconColors.white} />
          ) : (
            <EyeOffIcon color={iconColors.white} />
          )}
        </IconButton>
        <IconButton onPress={handleClearLogs}>
          <TrashIcon color={iconColors.white} />
        </IconButton>
      </View>
    </BottomControlBar>
  )
}
