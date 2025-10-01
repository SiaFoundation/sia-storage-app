import { View, Text, Pressable, StyleSheet, Alert, Switch } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>

export function SettingsHomeScreen({ navigation }: Props) {
  return (
    <View style={styles.panel}>
      <View style={styles.listGroup}>
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
        <Pressable onPress={() => navigation.navigate('Seed')}>
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Seed</Text>
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
        <Pressable onPress={() => navigation.navigate('Logs')}>
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Logs</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Advanced')}>
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Advanced</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: '#f6f8fa' },
  listGroup: {
    marginTop: 8,
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  rowLabel: { flex: 1, color: '#24292f', fontSize: 16 },
  rowChevron: { color: '#57606a', fontSize: 18 },
})
