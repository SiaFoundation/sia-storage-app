import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useAccount, useIndexerURL } from '@siastorage/core/stores'
import { DotIcon } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { RowGroup } from '../components/Group'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { humanSize } from '../lib/humanSize'
import { useToast } from '../lib/toastContext'
import type { MenuStackParamList } from '../stacks/types'
import { reconnectIndexer, useIsConnected } from '../stores/sdk'
import { palette } from '../styles/colors'

type Props = NativeStackScreenProps<MenuStackParamList, 'Indexer'>

export function SettingsIndexerScreen({ navigation }: Props) {
  const isConnected = useIsConnected()
  const currentIndexerURL = useIndexerURL()
  const toast = useToast()
  const [isReconnecting, setIsReconnecting] = useState(false)
  const account = useAccount()

  const handleReconnect = useCallback(async () => {
    setIsReconnecting(true)
    const success = await reconnectIndexer()
    setIsReconnecting(false)
    toast.show(success ? 'Reconnected' : 'Failed to reconnect')
  }, [toast])

  const handleSwitchIndexers = useCallback(() => {
    navigation.navigate('SwitchIndexer')
  }, [navigation])

  return (
    <SettingsScrollLayout style={{ paddingHorizontal: 24, gap: 24 }}>
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
                {
                  color: isConnected ? palette.green[500] : palette.red[500],
                },
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

      <View style={{ gap: 12 }}>
        <Button
          variant="secondary"
          onPress={handleReconnect}
          disabled={isReconnecting}
        >
          {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
        </Button>

        <Button onPress={handleSwitchIndexers}>Switch Indexers</Button>
      </View>
    </SettingsScrollLayout>
  )
}

const styles = StyleSheet.create({
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
