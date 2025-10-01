import { View, Text, StyleSheet } from 'react-native'
import { useIsConnected } from '../stores/auth'
import { DotIcon } from 'lucide-react-native'
import { RowGroup } from '../components/Group'
import { Button } from '../components/Button'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { InputRow } from '../components/InputRow'
import { useIndexerURL } from '../stores/settings'
import { useChangeIndexer } from '../hooks/useChangeIndexer'

export function SettingsIndexerScreen() {
  const isConnected = useIsConnected()
  const currentIndexerURL = useIndexerURL()
  const { newIndexerInputProps, saveIndexerURL, isWaiting } = useChangeIndexer()

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
          <LabeledValueRow label="URL" value={currentIndexerURL.data} />
        </InfoCard>
      </RowGroup>
      <View style={{ gap: 10 }}>
        <RowGroup title="Switch Indexers">
          <InfoCard>
            <InputRow
              label="URL"
              {...newIndexerInputProps}
              placeholder="https://example.com"
            />
          </InfoCard>
        </RowGroup>
        <Button onPress={saveIndexerURL}>
          {currentIndexerURL.data === newIndexerInputProps.value
            ? isWaiting
              ? 'Reconnecting...'
              : 'Reconnect'
            : isWaiting
            ? 'Connecting...'
            : 'Connect'}
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
