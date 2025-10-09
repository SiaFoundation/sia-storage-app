import { View, Text, StyleSheet } from 'react-native'
import { palette } from '../styles/colors'
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
import { humanSize } from '../lib/humanSize'
import { useAccount } from '../hooks/useAccount'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Indexer'>

export function SettingsIndexerScreen(_props: Props) {
  const isConnected = useIsConnected()
  const currentIndexerURL = useIndexerURL()
  const { newIndexerInputProps, saveAndOnboard, isWaiting } = useChangeIndexer()
  useSettingsHeader()
  const account = useAccount()
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
          {account.data ? (
            <>
              <LabeledValueRow
                label="Account Key"
                value={account.data.accountKey}
              />
              <LabeledValueRow
                label="Description"
                value={account.data.description}
              />
              <LabeledValueRow
                label="Used Storage"
                value={humanSize(Number(account.data.pinnedData))}
              />
              <LabeledValueRow
                label="Storage Limit"
                value={humanSize(Number(account.data.maxPinnedData))}
              />
            </>
          ) : null}
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
        <Button onPress={saveAndOnboard}>
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
