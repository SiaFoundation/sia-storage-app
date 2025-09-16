import { View, Pressable, StyleSheet, Text } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { RowGroup } from '../components/Group'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { cancelAllTransfers, useInflightCounts } from '../stores/transfers'
import { Button } from '../components/Button'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Transfers'>

export function SettingsTransfersScreen(_props: Props) {
  const inflight = useInflightCounts()

  return (
    <View style={styles.container}>
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
      <Button onPress={() => cancelAllTransfers()}>Cancel all transfers</Button>
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
    gap: 8,
  },
})
