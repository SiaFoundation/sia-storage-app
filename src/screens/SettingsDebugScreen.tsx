import { StyleSheet } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { SettingsDebugHash } from '../components/SettingsDebugHash'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Debug'>

export function SettingsDebugScreen(_props: Props) {
  useSettingsHeader()

  return (
    <SettingsLayout style={styles.container}>
      <SettingsDebugHash />
    </SettingsLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
  },
})
