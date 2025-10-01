import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { InfoCard } from '../components/InfoCard'
import { InputRow } from '../components/InputRow'
import { Button } from '../components/Button'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { useSeedHex } from '../stores/settings'

export function SettingsSeedScreen() {
  const seedHex = useSeedHex()
  const [isHidden, setIsHidden] = useState(true)
  const toast = useToast()

  return (
    <View style={styles.container}>
      <InfoCard>
        <InputRow
          label="Seed"
          value={isHidden ? '••••••••••••••••' : seedHex.data}
          editable={false}
          isMonospace
        />
      </InfoCard>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          onPress={() => setIsHidden((current) => !current)}
          style={styles.button}
        >
          {isHidden ? 'Show' : 'Hide'} seed
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            if (!seedHex.data) return
            Clipboard.setString(seedHex.data)
            toast.show('Copied seed')
          }}
          style={styles.button}
        >
          Copy seed
        </Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa', padding: 16 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  button: { flex: 1 },
})
