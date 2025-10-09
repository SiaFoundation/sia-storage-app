import { View, StyleSheet, Switch, Alert } from 'react-native'
import { colors, palette } from '../styles/colors'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { setShowAdvanced, useShowAdvanced } from '../stores/settings'
import { resetApp } from '../stores/app'
import { GroupTitle, RowGroup } from '../components/Group'
import { InfoCard } from '../components/InfoCard'
import { Button } from '../components/Button'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { SettingsRecoveryPhrase } from '../components/SettingsRecoveryPhrase'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { useAccount } from '../hooks/useAccount'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Advanced'>

export function SettingsAdvancedScreen(_props: Props) {
  const showAdvanced = useShowAdvanced()
  const account = useAccount()
  useSettingsHeader()

  return (
    <SettingsLayout style={styles.container}>
      {account.data ? (
        <RowGroup title="Account">
          <InfoCard>
            <LabeledValueRow
              label="Account Key"
              value={account.data.accountKey}
            />
          </InfoCard>
        </RowGroup>
      ) : null}
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
              'Reset Application',
              'This will delete all local metadata. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Permanently reset',
                  style: 'destructive',
                  onPress: () => resetApp(),
                },
              ]
            )
          }}
        >
          Reset application
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
  dangerRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgPanel,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dangerText: { color: palette.red[500], fontSize: 16, fontWeight: '600' },
})
