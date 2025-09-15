import { View, StyleSheet, Pressable, Text } from 'react-native'
import { LogView } from '../components/LogView'
import { useLogs, clearLogs } from '../stores/logs'

export function LogScreen() {
  const logs = useLogs()
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Logs</Text>
        <Pressable
          accessibilityRole="button"
          onPress={clearLogs}
          style={styles.clearBtn}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>
      <LogView logs={logs} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    height: 44,
    paddingHorizontal: 16,
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    flexDirection: 'row',
  },
  title: { color: '#24292f', fontSize: 16, fontWeight: '600' },
  clearBtn: { marginLeft: 'auto', paddingVertical: 6, paddingHorizontal: 8 },
  clearText: { color: '#0969da', fontWeight: '600' },
})
