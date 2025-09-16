import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import {
  useIsConnected,
  useIndexerURL,
  tryToConnectAndSet,
} from '../stores/auth'
import { DotIcon } from 'lucide-react-native'
import { useState } from 'react'
import { useToast } from '../lib/toastContext'
import { RowGroup } from '../components/Group'
import { Button } from '../components/Button'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { InputRow } from '../components/InputRow'

export function SettingsIndexerScreen() {
  const isConnected = useIsConnected()
  const indexerURL = useIndexerURL()
  const [currentIndexerURL, setCurrentIndexerURL] = useState(indexerURL)
  const toast = useToast()

  return (
    <View style={styles.container}>
      <RowGroup
        title="Current Indexer"
        indicator={
          <View style={styles.statusContainer}>
            <DotIcon color={isConnected ? 'green' : 'red'} />
            <Text
              style={[
                styles.statusText,
                { color: isConnected ? 'green' : 'red' },
              ]}
            >
              {isConnected ? 'Connected' : 'Offline'}
            </Text>
          </View>
        }
      >
        <InfoCard>
          <LabeledValueRow
            label="URL"
            value={indexerURL}
            isMonospace
            numberOfLines={1}
          />
        </InfoCard>
      </RowGroup>
      <View style={{ gap: 16 }}>
        <RowGroup title="Switch Indexers">
          <InfoCard>
            <InputRow
              label="URL"
              value={currentIndexerURL}
              onChangeText={setCurrentIndexerURL}
              placeholder="https://example.com"
            />
          </InfoCard>
        </RowGroup>
        <Button
          onPress={async () => {
            const success = await tryToConnectAndSet(currentIndexerURL)
            if (!success) {
              toast.show('Indexer connection failed')
              return
            }
            toast.show('Indexer connected')
          }}
        >
          {indexerURL === currentIndexerURL ? 'Reconnect' : 'Connect'}
        </Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 24,
  },
  cellRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  cellLabel: { width: 72, color: '#3c3c43', opacity: 0.6, fontSize: 16 },
  cellInput: {
    flex: 1,
    color: '#1c1c1e',
    fontSize: 16,
    paddingVertical: 6,
  },
  statusContainer: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  statusText: {
    fontSize: 14,
  },
})
