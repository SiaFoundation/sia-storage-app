import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SettingsAdvancedDatabase } from '../components/SettingsAdvancedDatabase'
import { SettingsAdvancedInfo } from '../components/SettingsAdvancedInfo'
import { SettingsAdvancedLogs } from '../components/SettingsAdvancedLogs'
import { SettingsAdvancedSync } from '../components/SettingsAdvancedSync'
import { SettingsAdvancedTransfers } from '../components/SettingsAdvancedTransfers'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import type { MenuStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<MenuStackParamList, 'Advanced'>

export function SettingsAdvancedScreen({ navigation }: Props) {
  return (
    <SettingsScrollLayout>
      <SettingsAdvancedLogs onViewLogs={() => navigation.navigate('Logs')} />
      <SettingsAdvancedInfo onImport={() => navigation.navigate('Import')} />
      <SettingsAdvancedTransfers />
      <SettingsAdvancedSync />
      <SettingsAdvancedDatabase />
    </SettingsScrollLayout>
  )
}
