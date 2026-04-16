import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { BackoffEntry } from '@siastorage/core/lib/backoffTracker'
import type { FileRecordRow } from '@siastorage/core/types/files'
import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  getImportBackoffEntries,
  retryAllImportFiles,
  retryImportFile,
} from '../managers/importScanner'
import { app } from '../stores/appService'
import type { MenuStackParamList } from '../stacks/types'
import { colors, palette } from '../styles/colors'

type Props = NativeStackScreenProps<MenuStackParamList, 'Import'>
type Tab = 'retrying' | 'lost'

function useImportBackoff() {
  const [entries, setEntries] = useState<BackoffEntry[]>([])
  const refresh = useCallback(() => setEntries(getImportBackoffEntries()), [])
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [refresh])
  return { entries, refresh }
}

function useLostFiles() {
  const [files, setFiles] = useState<FileRecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    try {
      const indexerURL = await app().settings.getIndexerURL()
      const result = await app().files.getLost(indexerURL)
      setFiles(result)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { files, loading, reload }
}

function formatRetryIn(retryAfter: number): string {
  const remaining = retryAfter - Date.now()
  if (remaining <= 0) return 'Retrying...'
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes >= 60) return `Retry in ${Math.round(minutes / 60)}h`
  return `Retry in ${minutes}m`
}

function RetryingTab() {
  const { entries, refresh } = useImportBackoff()

  const retryAll = useCallback(() => {
    retryAllImportFiles()
    refresh()
  }, [refresh])

  const retryOne = useCallback(
    (id: string) => {
      retryImportFile(id)
      refresh()
    },
    [refresh],
  )

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No files retrying</Text>
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.listHeader}>
        <Text style={styles.listHeaderCount}>{entries.length.toLocaleString()} retrying</Text>
        <Pressable onPress={retryAll}>
          <Text style={styles.retryAllText}>Retry all</Text>
        </Pressable>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowId} numberOfLines={1}>
                {item.id}
              </Text>
              <Text style={styles.rowReason} numberOfLines={1}>
                {item.reason ?? 'Unknown'}
              </Text>
              <Text style={styles.rowMeta}>
                {formatRetryIn(item.retryAfter)} · Attempt {item.attempts}
              </Text>
            </View>
            <Pressable onPress={() => retryOne(item.id)} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  )
}

function LostTab() {
  const { files, loading, reload } = useLostFiles()

  const removeAll = useCallback(() => {
    Alert.alert(
      'Remove all lost files',
      'This will permanently remove all lost files from this library. This cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove all',
          style: 'destructive',
          onPress: async () => {
            const indexerURL = await app().settings.getIndexerURL()
            await app().files.deleteLost(indexerURL)
            reload()
          },
        },
      ],
    )
  }, [reload])

  const removeOne = useCallback(
    async (id: string) => {
      await app().files.deleteWithThumbnails(id)
      reload()
    },
    [reload],
  )

  if (loading) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading...</Text>
      </View>
    )
  }

  if (files.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No lost files</Text>
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.listHeader}>
        <Text style={styles.listHeaderCount}>{files.length.toLocaleString()} lost</Text>
        <Pressable onPress={removeAll}>
          <Text style={styles.removeAllText}>Remove all</Text>
        </Pressable>
      </View>
      <FlatList
        data={files}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowReason} numberOfLines={1}>
                {item.lostReason ?? 'Local file missing, not uploaded'}
              </Text>
            </View>
            <Pressable onPress={() => removeOne(item.id)} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  )
}

export function SettingsImportScreen({ route }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(route.params?.tab ?? 'retrying')

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, activeTab === 'retrying' && styles.tabActive]}
          onPress={() => setActiveTab('retrying')}
        >
          <Text style={[styles.tabText, activeTab === 'retrying' && styles.tabTextActive]}>
            Retrying
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'lost' && styles.tabActive]}
          onPress={() => setActiveTab('lost')}
        >
          <Text style={[styles.tabText, activeTab === 'lost' && styles.tabTextActive]}>Lost</Text>
        </Pressable>
      </View>
      {activeTab === 'retrying' ? <RetryingTab /> : <LostTab />}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  flex: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomColor: palette.blue[400],
    borderBottomWidth: 2,
  },
  tabText: {
    color: palette.gray[400],
    fontSize: 15,
    fontWeight: '600',
  },
  tabTextActive: {
    color: palette.gray[50],
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 64,
  },
  emptyText: {
    color: palette.gray[400],
    fontSize: 15,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  listHeaderCount: {
    color: palette.gray[300],
    fontSize: 14,
  },
  removeAllText: {
    color: palette.red[500],
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 64,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: {
    flex: 1,
  },
  rowId: {
    color: palette.gray[100],
    fontSize: 13,
    fontFamily: 'monospace',
  },
  rowName: {
    color: palette.gray[100],
    fontSize: 15,
  },
  rowReason: {
    color: palette.gray[400],
    fontSize: 13,
    marginTop: 2,
  },
  rowMeta: {
    color: palette.gray[500],
    fontSize: 12,
    marginTop: 2,
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  removeButtonText: {
    color: palette.red[500],
    fontSize: 13,
    fontWeight: '600',
  },
  retryAllText: {
    color: palette.blue[400],
    fontSize: 14,
    fontWeight: '600',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  retryButtonText: {
    color: palette.blue[400],
    fontSize: 13,
    fontWeight: '600',
  },
})
