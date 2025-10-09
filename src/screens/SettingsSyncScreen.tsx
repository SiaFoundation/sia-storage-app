import { StyleSheet, Switch } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { cancelAllTransfers, useTransferCounts } from '../stores/transfers'
import { Button } from '../components/Button'
import { RowGroup } from '../components/Group'
import { InputRow } from '../components/InputRow'
import {
  setMaxTransfers,
  toggleAutoScanUploads,
  useAutoScanUploads,
  useMaxTransfers,
} from '../stores/settings'
import { useInputValue } from '../hooks/useInputValue'
import { SettingsLayout } from '../components/SettingsLayout'
import { colors } from '../styles/colors'
import { useSettingsHeader } from '../hooks/useSettingsHeader'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Sync'>

export function SettingsSyncScreen(_props: Props) {
  useSettingsHeader()
  const counts = useTransferCounts()
  const autoScan = useAutoScanUploads()
  const maxSlots = useMaxTransfers()

  const maxTransfersInputProps = useInputValue({
    value: String(maxSlots.data),
    save: (text) => {
      const n = Number(text.replace(/[^0-9]/g, ''))
      if (Number.isFinite(n) && n > 0) setMaxTransfers(n)
    },
  })

  return (
    <SettingsLayout style={styles.container}>
      <RowGroup title="Sync">
        <InfoCard>
          <LabeledValueRow
            label="Auto upload unsynced files"
            labelWidth={200}
            value={
              <Switch
                value={autoScan.data ?? false}
                onValueChange={toggleAutoScanUploads}
              />
            }
          />
        </InfoCard>
      </RowGroup>
      <RowGroup title="Transfers">
        <InfoCard>
          <InputRow
            label="Max concurrent"
            labelWidth={140}
            keyboardType="number-pad"
            {...maxTransfersInputProps}
          />
          <LabeledValueRow
            label="Queued"
            value={String(counts.totalQueued)}
            canCopy={false}
            labelWidth={140}
          />
          <LabeledValueRow
            label="Active"
            value={String(counts.totalActive)}
            canCopy={false}
            labelWidth={140}
          />
        </InfoCard>
        <Button
          style={{ marginTop: 10 }}
          disabled={counts.total === 0}
          onPress={() => cancelAllTransfers()}
        >
          Cancel all transfers
        </Button>
      </RowGroup>

      <RowGroup title="Uploads">
        <InfoCard>
          <LabeledValueRow
            label="Queued"
            value={String(counts.uploadsQueued)}
            canCopy={false}
          />
          <LabeledValueRow
            label="Active"
            value={String(counts.uploadsActive)}
            canCopy={false}
            showDividerTop
          />
        </InfoCard>
      </RowGroup>

      <RowGroup title="Downloads">
        <InfoCard>
          <LabeledValueRow
            label="Queued"
            value={String(counts.downloadsQueued)}
            canCopy={false}
          />
          <LabeledValueRow
            label="Active"
            value={String(counts.downloadsActive)}
            canCopy={false}
            showDividerTop
          />
        </InfoCard>
      </RowGroup>
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
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowLabel: {
    color: colors.textTitleDark,
  },
})
