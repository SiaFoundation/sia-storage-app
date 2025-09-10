import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { useSettings } from '../lib/settingsContext'

export default function IndexerScreen() {
  const { indexerName, setIndexerName, indexerUrl, setIndexerUrl } =
    useSettings()
  return (
    <View style={styles.container}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>Configuration</Text>
      </View>
      <View style={styles.group}>
        <View style={styles.cellRowTop}>
          <Text style={styles.cellLabel}>Name</Text>
          <TextInput
            value={indexerName}
            onChangeText={setIndexerName}
            placeholder="My Indexer"
            placeholderTextColor="#9ca3af"
            style={styles.cellInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
        <View style={styles.separator} />
        <View style={styles.cellRowBottom}>
          <Text style={styles.cellLabel}>URL</Text>
          <TextInput
            value={indexerUrl}
            onChangeText={setIndexerUrl}
            placeholder="https://example.com"
            placeholderTextColor="#9ca3af"
            style={styles.cellInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
          />
        </View>
      </View>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Save</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  groupHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  groupTitle: { color: '#6d6d72', fontSize: 13, fontWeight: '600' },
  group: {
    marginHorizontal: 16,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    borderColor: '#d1d1d6',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cellRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cellRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#c6c6c8',
    marginLeft: 16,
  },
  cellLabel: { width: 72, color: '#3c3c43', opacity: 0.6, fontSize: 16 },
  cellInput: {
    flex: 1,
    color: '#1c1c1e',
    fontSize: 16,
    paddingVertical: 6,
  },
  footer: { paddingHorizontal: 16, paddingTop: 16 },
  primaryButton: {
    backgroundColor: '#0a84ff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
})
