import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { RowGroup } from '../components/Group'
import { InfoCard } from '../components/InfoCard'
import { InputRow } from '../components/InputRow'
import { Button } from '../components/Button'
import { useAppSeed } from '../stores/auth'
import { encryptionKeyUint8ToHex } from '../lib/encryptionKey'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'

export function SettingsSeedScreen() {
  const appSeed = useAppSeed()
  const [isHidden, setIsHidden] = useState(true)
  const toast = useToast()

  const seedHex = encryptionKeyUint8ToHex(appSeed)

  return (
    <View style={styles.container}>
      <InfoCard>
        <InputRow
          label="Seed"
          value={isHidden ? '••••••••••••••••' : seedHex}
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
            Clipboard.setString(seedHex)
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
