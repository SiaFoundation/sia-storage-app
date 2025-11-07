import { Switch, View, Text, Pressable, StyleSheet } from 'react-native'
import { setShowAdvanced, useShowAdvanced } from '../stores/settings'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { colors, palette } from '../styles/colors'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Advanced'>

export function SettingsAdvancedInfo({ navigation }: Props) {
  const showAdvanced = useShowAdvanced()

  return (
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Debug"
          onPress={() => navigation.navigate('Debug')}
          style={styles.debugButton}
        >
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Debug</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </Pressable>
      </InfoCard>
    </RowGroup>
  )
}

const styles = StyleSheet.create({
  debugButton: {
    marginTop: 12,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
  },
  rowLabel: {
    flex: 1,
    color: palette.gray[100],
    fontSize: 16,
  },
  rowChevron: {
    color: palette.gray[300],
    fontSize: 18,
  },
})
