import {
  NativeStackNavigationProp,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack'
import React, { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native'
import { type MainStackParamList } from '../stacks/types'
import { useToast } from '../lib/toastContext'
import { useSdk } from '../stores/auth'
import { createFileRecord } from '../stores/files'
import { SealedObject } from 'react-native-sia'
import { useNavigation } from '@react-navigation/native'
import { uniqueId } from '../lib/uniqueId'
import { Button } from '../components/Button'
import { FileDetailsImport } from '../components/FileDetailsImport'
import { logger } from '../lib/logger'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { getIndexerURL } from '../stores/settings'
import { getAppKey } from '../lib/appKey'

type Props = NativeStackScreenProps<MainStackParamList, 'ImportFile'>

export function ImportFileScreen({ route }: Props) {
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>()
  const toast = useToast()
  const shareUrl = route.params?.shareUrl
  const sdk = useSdk()
  const sharedObject = useSWR(
    sdk ? ['sharedObject', shareUrl] : null,
    async () => {
      try {
        if (!sdk || !shareUrl) return null
        return sdk.sharedObject(shareUrl)
      } catch (e) {
        logger.log('Error getting shared object', e)
        return null
      }
    }
  )
  const sharedFile = useSWR(
    sharedObject.data ? ['sharedFile', shareUrl] : null,
    async () => {
      try {
        if (!sharedObject.data) return null
        const metadata = decodeFileMetadata(sharedObject.data.metadata())
        return {
          id: uniqueId(),
          size: Number(sharedObject.data.size()),
          fileSize: metadata.size ?? 0,
          fileType: metadata.fileType ?? '',
          fileName: metadata.name ?? '',
        }
      } catch (e) {
        logger.log('Error getting shared file', e)
        return null
      }
    }
  )

  const handleAddToDatabase = useCallback(async () => {
    if (!sharedObject.data || !sdk || !sharedFile.data) return
    const indexerURL = await getIndexerURL()
    const pinnedObject = await sdk.pinShared(sharedObject.data)
    const sealedObject = pinnedObject.seal(await getAppKey())
    await createFileRecord({
      ...sharedFile.data,
      createdAt: new Date().getTime(),
      sealedObjects: { [indexerURL]: sealedObject },
    })
    toast.show('File added')
    navigation.navigate('FileDetail', { id: sharedFile.data.id })
  }, [sharedFile.data, sdk, toast, navigation])

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {sharedFile.isValidating ? (
          <View style={styles.center}>
            <ActivityIndicator color="#0969da" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : sharedFile.error ? (
          <Text style={styles.errorText}>{sharedFile.error.message}</Text>
        ) : (
          <>
            {shareUrl && sharedFile.data && (
              <FileDetailsImport file={sharedFile.data} shareUrl={shareUrl} />
            )}
          </>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button onPress={handleAddToDatabase}>Add to library</Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: { padding: 0 },
  footer: { padding: 16 },
  title: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 12,
  },
  linkRow: { marginBottom: 12 },
  link: { color: '#0969da' },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  loadingText: { color: '#6b7280', marginTop: 8 },
  errorText: { color: '#c83532' },
  card: {
    maxHeight: 200,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  mono: {
    color: '#111827',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
  },
})
