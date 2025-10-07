import { View, Text, StyleSheet } from 'react-native'
import { colors, palette } from '../styles/colors'
import { useIsConnected } from '../stores/sdk'
import { DotIcon } from 'lucide-react-native'
import { RowGroup } from '../components/Group'
import { Button } from '../components/Button'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { InputRow } from '../components/InputRow'
import { useIndexerURL } from '../stores/settings'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'

export function SettingsIndexerScreen() {
  const isConnected = useIsConnected()
  const currentIndexerURL = useIndexerURL()
  const { newIndexerInputProps, saveIndexerURL, isWaiting } = useChangeIndexer()
  useSettingsHeader()

  return (
    <SettingsLayout style={styles.container}>
      <RowGroup
        title="Current Indexer"
        indicator={
          <View style={styles.statusContainer}>
            <View style={styles.statusDot}>
              <DotIcon
                color={isConnected ? palette.green[500] : palette.red[500]}
              />
            </View>
            <Text
              style={[
                styles.statusText,
                { color: isConnected ? palette.green[500] : palette.red[500] },
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
    </SettingsLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 24,
  },
  cellRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  cellLabel: {
    width: 72,
    color: palette.gray[600],
    opacity: 0.6,
    fontSize: 16,
  },
  cellInput: {
    flex: 1,
    color: palette.gray[800],
    fontSize: 16,
    paddingVertical: 6,
  },
  statusContainer: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  statusDot: { marginHorizontal: -3, transform: [{ scale: 1.5 }] },
  statusText: {
    fontSize: 14,
  },
})
