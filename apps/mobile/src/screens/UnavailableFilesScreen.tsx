import type { FileRecordRow } from '@siastorage/core/types'
import { useCallback } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusFileRow } from '../components/StatusFileRow'
import useSWR from 'swr'
import { useNow } from '../hooks/useNow'
import { humanSize } from '../lib/humanSize'
import { relativeTimePhrase } from '../lib/relativeTime'
import { app } from '../stores/appService'
import { colors, palette } from '../styles/colors'

// Files that went missing before they were uploaded: no object on the
// indexer and no local bytes, so nothing can recover them. The screen exists
// to let the user clear them; a row tap removes one, Remove all clears the
// bucket.

function UnavailableRow({
  file,
  now,
  first,
  onRemove,
}: {
  file: FileRecordRow
  now: number
  first: boolean
  onRemove: (file: FileRecordRow) => void
}) {
  return (
    <StatusFileRow
      name={file.name}
      detail={`added ${relativeTimePhrase(file.addedAt, now)} · ${humanSize(file.size)}`}
      trailing={<Text style={styles.remove}>Remove</Text>}
      first={first}
      onPress={() => onRemove(file)}
    />
  )
}

export function UnavailableFilesScreen() {
  const now = useNow()
  const { data: files, mutate } = useSWR('unavailable-files', async () => {
    const indexerURL = await app().settings.getIndexerURL()
    return app().files.getLost(indexerURL)
  })

  const removeOne = useCallback(
    (file: FileRecordRow) => {
      Alert.alert('Remove unavailable file', `Permanently remove "${file.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await app().files.deleteWithThumbnails(file.id)
            void mutate((prev) => prev?.filter((f) => f.id !== file.id), { revalidate: false })
          },
        },
      ])
    },
    [mutate],
  )

  const removeAll = useCallback(() => {
    Alert.alert(
      'Remove all unavailable files',
      'This will permanently remove all unavailable files from this library. This cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove all',
          style: 'destructive',
          onPress: async () => {
            const indexerURL = await app().settings.getIndexerURL()
            await app().files.deleteLost(indexerURL)
            void mutate([], { revalidate: false })
          },
        },
      ],
    )
  }, [mutate])

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={files ?? []}
      keyExtractor={(f) => f.id}
      ListHeaderComponent={
        (files?.length ?? 0) > 0 ? (
          <View style={styles.headerBlock}>
            <Text style={styles.explainer}>
              These files went missing from this device before they were uploaded, so their contents
              can't be recovered here.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={removeAll}
              style={({ pressed }) => [styles.removeAll, pressed ? styles.rowPressed : null]}
            >
              <Text style={styles.removeAllText}>Remove all unavailable files</Text>
            </Pressable>
          </View>
        ) : null
      }
      renderItem={({ item, index }) => (
        <UnavailableRow file={item} now={now} first={index === 0} onRemove={removeOne} />
      )}
      ListEmptyComponent={files ? <Text style={styles.empty}>No unavailable files.</Text> : null}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  content: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  headerBlock: {
    marginBottom: 12,
    gap: 12,
  },
  explainer: {
    color: palette.gray[400],
    fontSize: 13,
    lineHeight: 18,
  },
  removeAll: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  removeAllText: {
    color: palette.red[500],
    fontSize: 15,
    fontWeight: '500',
  },
  rowPressed: {
    opacity: 0.6,
  },
  remove: {
    color: palette.red[500],
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    color: palette.gray[400],
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 32,
  },
})
