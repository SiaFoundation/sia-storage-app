import { useEffect, useState } from 'react'
import {
  Text,
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native'
import { getHostSettings, setLogger, clearLogger } from 'react-native-sia'

export default function HostSettings() {
  const [hostSettings, setHostSettings] = useState<string | null>(null)
  const [address, setAddress] = useState(
    '6r4b0vj1ai55fobdvauvpg3to5bpeijl045b2q268fcj7q1vkuog.sia.host'
  )
  const [port, setPort] = useState('9984')
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    const logger = {
      log(level: string, message: string) {
        setLogs((prev) => [...prev, `[${level}] ${message}`])
      },
    }
    setLogger(logger)
    return () => {
      clearLogger()
    }
  }, [])

  const handleGetHostSettings = async () => {
    setLogs((prev) => [...prev, '[info] Requesting host settings…'])
    try {
      const numPort = Number.parseInt(port, 10)
      const settings = await getHostSettings(
        address,
        Number.isNaN(numPort) ? 0 : numPort
      )
      setHostSettings(settings)
      setLogs((prev) => [...prev, '[info] Received host settings'])
    } catch (err: any) {
      console.log(err)
      setLogs((prev) => [...prev, `[error] ${String(err?.message ?? err)}`])
    }
  }

  const hostSettingsDisplay = hostSettings
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(hostSettings), null, 2)
        } catch {
          return hostSettings
        }
      })()
    : '—'

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Host Settings</Text>
        <TextInput
          style={styles.input}
          placeholder="Address"
          autoCapitalize="none"
          autoCorrect={false}
          value={address}
          onChangeText={setAddress}
        />
        <TextInput
          style={styles.input}
          placeholder="Port"
          keyboardType="number-pad"
          value={port}
          onChangeText={setPort}
        />
        <Pressable style={styles.button} onPress={handleGetHostSettings}>
          <Text style={styles.buttonText}>Get Host Settings</Text>
        </Pressable>
        <View style={styles.rowBetween}>
          <Text style={styles.subheading}>Result</Text>
          <Pressable
            onPress={() => setHostSettings(null)}
            style={styles.clearButton}
          >
            <Text style={styles.clearButtonText}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.resultBox}
          contentContainerStyle={styles.resultContent}
        >
          <Text style={styles.mono}>{hostSettingsDisplay}</Text>
        </ScrollView>
      </View>
      <View style={[styles.card, styles.cardGrow]}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Logs</Text>
          <Pressable onPress={() => setLogs([])} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.logBox}
          contentContainerStyle={styles.resultContent}
        >
          {logs.map((l, i) => (
            <Text key={String(i)} style={styles.logLine}>
              {l}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f19' },
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e6edf3',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e6edf3',
    marginBottom: 8,
  },
  subheading: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9da7b3',
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#111827',
    borderColor: '#1f2937',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  cardGrow: {
    flex: 1,
    minHeight: 0,
  },
  input: {
    backgroundColor: '#0b1220',
    borderColor: '#334155',
    borderWidth: StyleSheet.hairlineWidth,
    color: '#e6edf3',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#0ea5e9',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: '#001019',
    fontWeight: '700',
  },
  resultBox: {
    maxHeight: 140,
    backgroundColor: '#0b1220',
    borderColor: '#334155',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  resultContent: {
    padding: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mono: {
    color: '#cbd5e1',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
  },
  logBox: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#0b1220',
    borderColor: '#334155',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  logLine: {
    color: '#9da7b3',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
    marginBottom: 4,
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1f2937',
  },
  clearButtonText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
})
