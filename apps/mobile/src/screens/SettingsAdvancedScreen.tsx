import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { InsetGroupLink, InsetGroupSection } from '../components/InsetGroup'
import { SettingsAdvancedInfo } from '../components/SettingsAdvancedInfo'
import { SettingsAdvancedSync } from '../components/SettingsAdvancedSync'
import { SettingsAdvancedTransfers } from '../components/SettingsAdvancedTransfers'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import type { MenuStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<MenuStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(props: Props) {
  const { navigation } = props
  return (
    <SettingsScrollLayout>
      <InsetGroupSection header="Tools">
        <InsetGroupLink label="Import" onPress={() => navigation.navigate('Import')} />
        <InsetGroupLink label="Logs" onPress={() => navigation.navigate('Logs')} />
      </InsetGroupSection>
      <SettingsAdvancedInfo {...props} />
      <SettingsAdvancedTransfers />
      <SettingsAdvancedSync />
    </SettingsScrollLayout>
  )
}
