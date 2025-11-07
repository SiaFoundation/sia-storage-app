import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, palette } from '../styles/colors'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { SettingsLayout } from '../components/SettingsLayout'
import { useSettingsHeader } from '../hooks/useSettingsHeader'

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>

export function SettingsHomeScreen({ navigation }: Props) {
  useSettingsHeader()
  return (
    <SettingsLayout style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Indexer')}
      >
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Indexer</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Sync')}
      >
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Sync</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Hosts')}
      >
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Hosts</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Advanced"
        onPress={() => navigation.navigate('Advanced')}
      >
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Advanced</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Logs"
        onPress={() => navigation.navigate('Logs')}
      >
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Logs</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Pressable>
    </SettingsLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 32,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgPanel,
  },
  rowLabel: { flex: 1, color: palette.gray[100], fontSize: 16 },
  rowChevron: { color: palette.gray[300], fontSize: 18 },
})
