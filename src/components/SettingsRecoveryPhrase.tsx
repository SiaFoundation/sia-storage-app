import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { InfoCard } from './InfoCard'
import { Button } from './Button'
import { useRecoveryPhrase } from '../stores/settings'
import { useCopyRecoveryPhrase } from '../hooks/useCopyRecoveryPhrase'
import { InputArea } from './InputArea'
import { RowGroup } from './Group'

export function SettingsRecoveryPhrase() {
  const recoveryPhrase = useRecoveryPhrase()
  const [isHidden, setIsHidden] = useState(true)
  const copyRecoveryPhrase = useCopyRecoveryPhrase()

  return (
    <RowGroup title="Recovery phrase">
      <InfoCard>
        <InputArea
          label="Recovery phrase"
          value={isHidden ? '•'.repeat(80) : recoveryPhrase.data}
          editable={false}
          height={80}
          isMonospace
        />
      </InfoCard>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          onPress={() => setIsHidden((current) => !current)}
          style={styles.button}
        >
          {isHidden ? 'Show' : 'Hide'} phrase
        </Button>
        <Button
          variant="secondary"
          onPress={copyRecoveryPhrase}
          style={styles.button}
        >
          Copy phrase
        </Button>
      </View>
    </RowGroup>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  button: { flex: 1 },
})
