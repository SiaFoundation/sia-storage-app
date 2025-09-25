import { View, StyleSheet, Text, Switch } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { cancelAllTransfers, useInflightCounts } from '../stores/transfers'
import { Button } from '../components/Button'
import { setAutoScanUploads, useAutoScanUploads } from '../stores/uploadScanner'
import { RowGroup } from '../components/Group'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Transfers'>

export function SettingsTransfersScreen(_props: Props) {
  const inflight = useInflightCounts()
  const autoScan = useAutoScanUploads()

  return (
    <View style={styles.container}>
      <RowGroup title="Sync">
        <InfoCard>
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Auto upload unsynced files</Text>
            <Switch
              value={autoScan}
              onValueChange={(val) => setAutoScanUploads(val)}
            />
          </View>
        </InfoCard>
      </RowGroup>
      <RowGroup title="Transfers">
        <InfoCard>
          <LabeledValueRow
            label="Uploads"
            value={String(inflight.uploads)}
            canCopy={false}
          />
          <LabeledValueRow
            label="Downloads"
            value={String(inflight.downloads)}
            canCopy={false}
            showDividerTop
          />
          <LabeledValueRow
            label="Total"
            value={String(inflight.total)}
            canCopy={false}
            showDividerTop
          />
        </InfoCard>
        <Button
          style={{ marginTop: 12 }}
          disabled={inflight.total === 0}
          onPress={() => cancelAllTransfers()}
        >
          Cancel all transfers
        </Button>
      </RowGroup>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowLabel: {
    color: '#111827',
  },
})
