import { View, StyleSheet, Pressable, Text } from 'react-native'
import { LogView } from '../components/LogView'
import { clearLogs, useLogs } from '../stores/logs'
import { useLayoutEffect } from 'react'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Logs'>

export function SettingsLogsScreen({ navigation }: Props) {
  const logs = useLogs()
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          onPress={clearLogs}
          style={styles.clearBtn}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      ),
    })
  }, [navigation])
  return (
    <View style={styles.container}>
      <LogView logs={logs} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  clearBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  clearText: { color: '#0969da', fontWeight: '600' },
})
