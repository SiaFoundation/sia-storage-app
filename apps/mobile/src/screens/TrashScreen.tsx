/*
 * The trash. Each row is a file with the versions trashed along with it, and
 * tapping one offers to put it back or delete it for good. Empty Trash deletes
 * everything in it. The trash deletes an entry for good on its own 30 days
 * after it was trashed, which each row counts down to.
 */

import { itemCount, restoredText, trashEntryDetail } from '@siastorage/core/lib/trashText'
import { TRASH_PAGE, useTrashCount, useTrashEntries } from '@siastorage/core/stores'
import type { TrashEntry } from '@siastorage/core/types'
import { useNavigation } from '@react-navigation/native'
import { useCallback, useLayoutEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { InsetGroupLink, InsetGroupSection } from '../components/InsetGroup'
import { useNow } from '../hooks/useNow'
import { useToast } from '../lib/toastContext'
import { app } from '../stores/appService'
import { colors, palette } from '../styles/colors'

export function TrashScreen() {
  const navigation = useNavigation()
  const [limit, setLimit] = useState(TRASH_PAGE)
  const entries = useTrashEntries(limit)
  // The whole trash, which Empty Trash deletes, where the list may show part.
  const count = useTrashCount().data ?? 0
  const now = useNow()
  const toast = useToast()
  const hidden = count - (entries.data?.length ?? 0)

  const emptyTrash = useCallback(() => {
    Alert.alert(
      `Delete ${itemCount(count)} for good?`,
      'They are removed from this device and every other device on your account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty Trash',
          style: 'destructive',
          onPress: () => {
            app()
              .files.emptyTrash()
              .catch(() => toast.show('Could not empty the trash. Try again.'))
          },
        },
      ],
    )
  }, [count, toast])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        count > 0 ? (
          <Pressable onPress={emptyTrash} hitSlop={12} accessibilityRole="button">
            <Text style={styles.headerButton}>Empty</Text>
          </Pressable>
        ) : null,
    })
  }, [navigation, count, emptyTrash])

  const openEntry = useCallback(
    (entry: TrashEntry) => {
      Alert.alert(entry.name, trashEntryDetail(entry, Date.now()), [
        {
          text: 'Restore',
          onPress: () => {
            app()
              .files.restoreTrashEntries([entry.id])
              .then((restored) => toast.show(restoredText(entry.name, restored)))
              .catch(() => toast.show('Could not restore it. Try again.'))
          },
        },
        {
          text: 'Delete Now',
          style: 'destructive',
          onPress: () => {
            app()
              .files.deleteTrashEntries([entry.id])
              .catch(() => toast.show('Could not delete it. Try again.'))
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ])
    },
    [toast],
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {entries.data && entries.data.length > 0 ? (
        <InsetGroupSection footer="Files in the trash are deleted for good 30 days after you trash them.">
          {entries.data.map((entry) => {
            const detail = trashEntryDetail(entry, now)
            return (
              <InsetGroupLink
                key={entry.id}
                label={entry.name}
                description={detail}
                accessibilityLabel={`${entry.name}, ${detail}`}
                onPress={() => openEntry(entry)}
                showChevron={false}
              />
            )
          })}
          {hidden > 0 ? (
            <InsetGroupLink
              label={`Show ${Math.min(hidden, TRASH_PAGE).toLocaleString()} more`}
              onPress={() => setLimit((n) => n + TRASH_PAGE)}
              showChevron={false}
            />
          ) : null}
        </InsetGroupSection>
      ) : (
        <Text testID="trash-empty" style={styles.empty}>
          {entries.data ? 'The trash is empty.' : 'Loading…'}
        </Text>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  content: {
    paddingTop: 24,
    paddingBottom: 64,
  },
  headerButton: {
    color: palette.red[500],
    fontSize: 17,
  },
  empty: {
    color: palette.gray[400],
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
})
