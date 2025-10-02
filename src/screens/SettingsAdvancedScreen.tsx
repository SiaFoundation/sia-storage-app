import { View, StyleSheet, Switch, Alert } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { setShowAdvanced, useShowAdvanced } from '../stores/settings'
import { resetApp } from '../stores/auth'
import { GroupTitle, RowGroup } from '../components/Group'
import { InfoCard } from '../components/InfoCard'
import { Button } from '../components/Button'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { SettingsRecoveryPhrase } from '../components/SettingsRecoveryPhrase'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(_props: Props) {
  const showAdvanced = useShowAdvanced()

  return (
    <View style={styles.container}>
      <SettingsRecoveryPhrase />
      <RowGroup title="Developers">
        <InfoCard>
          <LabeledValueRow
            label="Show advanced information"
            labelWidth={200}
            value={
              <Switch
                value={showAdvanced.data}
                onValueChange={(val) => setShowAdvanced(val)}
              />
            }
          />
        </InfoCard>
      </RowGroup>
      <View>
        <GroupTitle title="Danger Zone" />
        <Button
          variant="danger"
          onPress={() => {
            Alert.alert(
              'Reset App',
              'This will delete all local metadata and reset your app seed. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => resetApp(),
                },
              ]
            )
          }}
        >
          Reset app
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
    paddingTop: 16,
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
    color: '#111827',
  },
  dangerRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dangerText: { color: '#c83532', fontSize: 16, fontWeight: '600' },
})
