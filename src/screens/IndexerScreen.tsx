import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { useSettings } from '../lib/settingsContext'
import { DotIcon } from 'lucide-react-native'
import { useState } from 'react'
import { useToast } from '../lib/toastContext'
import { RowGroup } from '../components/Group'
import { Button } from '../components/Button'

export default function IndexerScreen() {
  const { authIndexer, isConnected, indexerName, setIndexerName, indexerURL } =
    useSettings()
  const [currentIndexerURL, setCurrentIndexerURL] = useState(indexerURL)
  const toast = useToast()

  return (
    <View style={styles.container}>
      <RowGroup
        title="Configuration"
        indicator={
          <View style={styles.statusContainer}>
            <DotIcon color={isConnected ? 'green' : 'red'} />
            <Text
              style={[
                styles.statusText,
                { color: isConnected ? 'green' : 'red' },
              ]}
            >
              {isConnected ? 'Online' : 'Offline'}
            </Text>
          </View>
        }
      >
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
            value={currentIndexerURL}
            onChangeText={setCurrentIndexerURL}
            placeholder="https://example.com"
            placeholderTextColor="#9ca3af"
            style={styles.cellInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
          />
        </View>
      </RowGroup>
      <View style={styles.footer}>
        <Button
          style={[
            indexerURL === currentIndexerURL && {
              backgroundColor: 'lightgrey',
            },
          ]}
          disabled={indexerURL === currentIndexerURL}
          onPress={() => {
            const success = authIndexer(currentIndexerURL)
            if (!success) {
              toast.show('New Indexer auth failed. Using previous indexer.')
              return
            }
            toast.show('New Indexer auth successful.')
          }}
        >
          Authorize New Indexer
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
    paddingTop: 12,
    paddingBottom: 24,
  },
  group: {
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
  footer: { paddingTop: 16 },
  primaryButton: {
    backgroundColor: '#0a84ff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
  statusContainer: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  statusText: {
    fontSize: 12,
  },
})
