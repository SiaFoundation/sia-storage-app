import { View, Text, Pressable, StyleSheet, Alert } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { resetApp } from '../stores/auth'

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
          onPress={() => navigation.navigate('Hosts')}
        >
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Hosts</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Transfers')}
        >
          <View style={styles.rowItem}>
            <Text style={styles.rowLabel}>Transfers</Text>
            <Text style={styles.rowChevron}>›</Text>
          </View>
        </Pressable>
      </View>
      <View style={styles.footerGroup}>
        <Pressable
          accessibilityRole="button"
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
          <View style={styles.dangerRow}>
            <Text style={styles.dangerText}>Reset app</Text>
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
  rowValue: { color: '#57606a', fontSize: 16 },
  rowChevron: { color: '#57606a', fontSize: 18 },
  footerGroup: { marginTop: 24 },
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
