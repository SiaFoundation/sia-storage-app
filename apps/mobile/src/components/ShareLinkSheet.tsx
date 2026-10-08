/*
 * The share link sheet. Mounted once at the app root and opened from a file's
 * menu, the selection bar, the viewer's share button and the list of links.
 *
 * It has two views. Opened on files, it asks what the link should show and
 * how long it should last before making it, because the indexer fixes both
 * when the link is made. Opened on a link, or once one is made, it shows the
 * link's address with Copy and Share, the files on it, and Revoke.
 */

import Clipboard from '@react-native-clipboard/clipboard'
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  expiresAt,
  expiryLabel,
  linkProgress,
  linkTitle,
  MODE_CHOICES,
  modeLabel,
  shareErrorText,
} from '@siastorage/core/lib/shareLinkText'
import { useShareLinks } from '@siastorage/core/stores'
import type { ShareLink, ShareLinkFile, ShareLinkMode } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, CopyIcon, LinkIcon } from 'lucide-react-native'
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import useSWR from 'swr'
import { useNow } from '../hooks/useNow'
import { useShareAction } from '../hooks/useShareAction'
import { humanSize } from '../lib/humanSize'
import { useToast } from '../lib/toastContext'
import { app } from '../stores/appService'
import { closeShareLinkSheet, useShareLinkSheet } from '../stores/shareLinkSheet'
import { colors, palette } from '../styles/colors'
import { Button } from './Button'
import {
  InsetGroupChoiceRow,
  InsetGroupLink,
  InsetGroupSection,
  InsetGroupValueRow,
} from './InsetGroup'
import { ModalSheet } from './ModalSheet'

/** Rows shown before the rest of a long list is folded into one "and N more" row. */
const MAX_FILE_ROWS = 20

type ListedFile = { id: string; name: string; detail: string | null }

function FileRows({ files }: { files: ListedFile[] }) {
  const shown = files.slice(0, MAX_FILE_ROWS)
  const more = files.length - shown.length
  return (
    <InsetGroupSection header={files.length === 1 ? 'File' : `${files.length} files`}>
      {shown.map((file) => (
        <InsetGroupValueRow key={file.id} label={file.name} value={file.detail ?? undefined} />
      ))}
      {more > 0 ? <InsetGroupValueRow label={`and ${more.toLocaleString()} more`} /> : null}
    </InsetGroupSection>
  )
}

/**
 * The link as its field shows it: the site, then the last characters of the
 * key, which is what tells two links apart. The address ends in a
 * 64-character key, and letting the text view elide it cuts the site's name.
 */
function shortLink(url: string): string {
  return `${new URL(url).hostname}/…${url.slice(-8)}`
}

function linkFileDetail(file: ShareLinkFile): string | null {
  if (file.state === 'pending') return 'Uploading'
  if (file.state === 'trashed') return 'In the trash'
  return humanSize(file.size)
}

/** The system share sheet, with the file itself. Shown for one file that has a copy on this device. */
function ExportFileRow({ fileId }: { fileId: string }) {
  const { canExport, handleShareFile } = useShareAction({ fileId })
  if (!canExport) return null
  return (
    <InsetGroupSection footer="Sends the file itself to another app.">
      <InsetGroupLink
        label="Export file"
        onPress={() => void handleShareFile()}
        showChevron={false}
      />
    </InsetGroupSection>
  )
}

function NewLink({
  fileIds,
  onCreated,
}: {
  fileIds: string[]
  onCreated: (link: ShareLink) => void
}) {
  const [mode, setMode] = useState<ShareLinkMode>('latest')
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const files = useSWR(['share-link-files', ...fileIds], () => app().files.getByIds(fileIds))

  const create = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      onCreated(
        await app().shares.createLink(fileIds, { expiresAt: expiresAt(expiry, Date.now()), mode }),
      )
    } catch (e) {
      logger.error('shareLinks', 'create_failed', { error: e as Error })
      setError(shareErrorText(e, 'Could not make the link. Try again.'))
    } finally {
      setCreating(false)
    }
  }, [fileIds, expiry, mode, onCreated])

  return (
    <>
      <FileRows
        files={(files.data ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          detail: humanSize(f.size),
        }))}
      />

      <InsetGroupSection header="Link shows">
        {MODE_CHOICES.map((choice) => (
          <InsetGroupChoiceRow
            key={choice.id}
            label={choice.label}
            description={choice.detail}
            selected={mode === choice.id}
            onPress={() => setMode(choice.id)}
          />
        ))}
      </InsetGroupSection>

      <InsetGroupSection
        header="Link expires"
        footer={
          mode === 'latest'
            ? 'Anyone with the link can see and download these files, always at their latest version.'
            : 'Anyone with the link can see and download these files as they are now.'
        }
      >
        {EXPIRY_CHOICES.map((choice) => (
          <InsetGroupChoiceRow
            key={choice.id}
            label={choice.label}
            selected={expiry === choice.id}
            onPress={() => setExpiry(choice.id)}
          />
        ))}
      </InsetGroupSection>

      <View style={styles.actions}>
        {error ? (
          <Text testID="share-link-error" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Button onPress={() => void create()} disabled={creating || files.data?.length === 0}>
          {creating ? 'Creating Link…' : 'Create Link'}
        </Button>
      </View>

      {fileIds.length === 1 ? <ExportFileRow fileId={fileIds[0]} /> : null}
    </>
  )
}

function ExistingLink({ link }: { link: ShareLink }) {
  const toast = useToast()
  const now = useNow()
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = link.url

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = useCallback(() => {
    Clipboard.setString(url)
    setCopied(true)
  }, [url])

  const share = useCallback(() => {
    // React Native's Share passes `url` to iOS only, so Android gets the
    // address as the message.
    void Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch((e) => {
      logger.error('shareLinks', 'share_failed', { error: e as Error })
    })
  }, [url])

  const revoke = useCallback(() => {
    Alert.alert('Revoke link', 'Anyone who has this link will no longer be able to open it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          setRevoking(true)
          setError(null)
          try {
            await app().shares.revokeLink(link.publicKey)
            closeShareLinkSheet()
            toast.show('Link revoked')
          } catch (e) {
            logger.error('shareLinks', 'revoke_failed', { error: e as Error })
            setError(shareErrorText(e, 'Could not revoke the link. Try again.'))
          } finally {
            setRevoking(false)
          }
        },
      },
    ])
  }, [link.publicKey, toast])

  return (
    <>
      <View style={styles.linkCard}>
        <Text style={styles.linkTitle} numberOfLines={1}>
          {linkTitle(link)}
        </Text>
        <Text style={styles.linkDetail}>
          {[modeLabel(link.mode), expiryLabel(link.expiresAt, now), linkProgress(link)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Pressable
          testID="share-link-url"
          accessibilityRole="button"
          accessibilityLabel={`Link, ${shortLink(url)}`}
          accessibilityHint="Copies the link"
          onPress={copy}
          style={({ pressed }) => [styles.linkField, pressed ? styles.linkFieldPressed : null]}
        >
          <LinkIcon size={16} color={palette.gray[400]} />
          <Text style={styles.linkFieldText} numberOfLines={1}>
            {shortLink(url)}
          </Text>
          {copied ? (
            <CheckIcon size={16} color={palette.blue[400]} />
          ) : (
            <CopyIcon size={16} color={palette.gray[400]} />
          )}
        </Pressable>
        <View style={styles.linkButtons}>
          <Button style={styles.linkButton} onPress={copy}>
            {copied ? 'Copied' : 'Copy Link'}
          </Button>
          <Button style={styles.linkButton} variant="secondary" onPress={share}>
            Share…
          </Button>
        </View>
      </View>

      <FileRows
        files={link.files.map((f) => ({ id: f.fileId, name: f.name, detail: linkFileDetail(f) }))}
      />

      <InsetGroupSection footer={error ?? undefined}>
        <InsetGroupLink
          label={revoking ? 'Revoking…' : 'Revoke Link'}
          destructive
          disabled={revoking}
          onPress={revoke}
          showChevron={false}
        />
      </InsetGroupSection>
    </>
  )
}

/**
 * The link named by `publicKey`, read from the list so that a change made on
 * another device shows. `made` is the link as `createLink` returned it, shown
 * until the list has been read again, which is the first read that holds it.
 */
function LinkView({ publicKey, made }: { publicKey: string; made: ShareLink | null }) {
  const links = useShareLinks()
  const reading = links.isValidating || !links.data
  const link = links.data?.find((l) => l.publicKey === publicKey) ?? (reading ? made : null)
  if (link) return <ExistingLink link={link} />
  return (
    <Text style={styles.gone}>
      {reading ? 'Loading…' : 'This link has expired or was revoked.'}
    </Text>
  )
}

export function ShareLinkSheet() {
  const state = useShareLinkSheet()
  // The last opening stays on screen while the sheet slides away.
  const [shown, setShown] = useState(state)
  if (state.target && state !== shown) setShown(state)
  const { target, opening } = state.target ? state : shown
  // The link made during an opening on files, which that opening then shows.
  const [created, setCreated] = useState<{ opening: number; link: ShareLink } | null>(null)
  const made = created?.opening === opening ? created.link : null

  const publicKey = made?.publicKey ?? (target && 'publicKey' in target ? target.publicKey : null)

  return (
    <ModalSheet
      visible={state.target !== null}
      onRequestClose={closeShareLinkSheet}
      title="Share Link"
    >
      <ScrollView contentContainerStyle={styles.content}>
        {publicKey ? (
          <LinkView key={opening} publicKey={publicKey} made={made} />
        ) : target && 'fileIds' in target ? (
          <NewLink
            key={opening}
            fileIds={target.fileIds}
            onCreated={(link) => setCreated({ opening, link })}
          />
        ) : null}
      </ScrollView>
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 12,
    paddingBottom: 48,
  },
  actions: {
    paddingHorizontal: 16,
    marginBottom: 28,
    gap: 10,
  },
  error: {
    color: colors.textDanger,
    fontSize: 13,
    paddingHorizontal: 16,
  },
  linkCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 28,
    padding: 16,
    gap: 4,
  },
  linkTitle: {
    color: palette.gray[50],
    fontSize: 17,
    fontWeight: '600',
  },
  linkDetail: {
    color: palette.gray[400],
    fontSize: 13,
  },
  linkField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.bgCanvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  linkFieldPressed: {
    opacity: 0.6,
  },
  linkFieldText: {
    flex: 1,
    color: palette.gray[200],
    fontSize: 13,
    fontFamily: 'Menlo',
  },
  linkButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  linkButton: {
    flex: 1,
    paddingHorizontal: 12,
  },
  gone: {
    color: palette.gray[400],
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
})
