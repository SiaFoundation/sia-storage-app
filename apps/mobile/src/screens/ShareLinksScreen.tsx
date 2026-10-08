/*
 * The account's share links. Each row opens the share link sheet on that
 * link, where it can be copied, shared and revoked. New links are made from a
 * file's menu or a selection, so this screen only lists.
 */

import { expiryLabel, linkProgress, linkTitle, modeLabel } from '@siastorage/core/lib/shareLinkText'
import { useShareLinks } from '@siastorage/core/stores'
import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native'
import { InsetGroupLink, InsetGroupSection } from '../components/InsetGroup'
import { useNow } from '../hooks/useNow'
import { app } from '../stores/appService'
import { openShareLinkSheet } from '../stores/shareLinkSheet'
import { colors, palette } from '../styles/colors'

/**
 * Lists the account's sharing keys again, which is how a link made or revoked
 * on another device shows here. The background pass does it only every few
 * minutes.
 */
function refreshLinks(): Promise<void> {
  return app()
    .shares.syncLinks({ refresh: true })
    .catch(() => {})
}

export function ShareLinksScreen() {
  const links = useShareLinks()
  const now = useNow()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void refreshLinks()
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await refreshLinks()
    setRefreshing(false)
  }, [])

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={palette.gray[400]}
        />
      }
    >
      {links.data && links.data.length > 0 ? (
        <InsetGroupSection footer="Anyone with a link can see and download its files until it expires or is revoked.">
          {links.data.map((link) => {
            const title = linkTitle(link)
            const description = [
              modeLabel(link.mode),
              expiryLabel(link.expiresAt, now),
              linkProgress(link),
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <InsetGroupLink
                key={link.publicKey}
                label={title}
                description={description}
                // Two links to one file share a title, so the label carries
                // what tells them apart.
                accessibilityLabel={`${title}, ${description}`}
                onPress={() => openShareLinkSheet({ publicKey: link.publicKey })}
                showChevron={false}
              />
            )
          })}
        </InsetGroupSection>
      ) : (
        <Text testID="share-links-empty" style={styles.empty}>
          {links.data
            ? 'No share links yet. To make one, open a file’s menu or select files, then choose Share link.'
            : 'Loading…'}
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
  empty: {
    color: palette.gray[400],
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
})
