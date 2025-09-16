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
import { useIndexerURL, useSdk } from '../stores/auth'
import { createFileRecord } from '../stores/files'
import { PinnedObject } from 'react-native-sia'
import { useNavigation } from '@react-navigation/native'
import { uniqueId } from '../lib/uniqueId'
import { encryptionKeyArrayBufferToHex } from '../lib/encryptionKey'
import { Button } from '../components/Button'
import { FileDetailsImport } from '../components/FileDetailsImport'
import { logger } from '../lib/logger'
import {
  decodeFileMetadata,
  encodeFileMetadata,
} from '../encoding/fileMetadata'

type Props = NativeStackScreenProps<MainStackParamList, 'ImportFile'>

export function ImportFileScreen({ route }: Props) {
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>()
  const toast = useToast()
  const shareUrl = route.params?.shareUrl
  const sdk = useSdk()
  const indexerURL = useIndexerURL()
  const sharedObject = useSWR(
    sdk ? ['sharedObject', shareUrl] : null,
    async () => {
      try {
        if (!sdk) return null
        const sharedObject = await sdk.sharedObject(shareUrl ?? '')
        return sharedObject
      } catch (e) {
        logger.log('Error getting shared object', e)
        return null
      }
    }
  )
  const decodedMetadata = useMemo(() => {
    if (!sharedObject.data?.meta) return {}
    return decodeFileMetadata(sharedObject.data?.meta)
  }, [sharedObject.data?.meta])
  const id = useMemo(() => uniqueId(), [shareUrl])
  const file = useMemo(
    () => ({
      id,
      fileType: decodedMetadata?.fileType ?? '',
      fileSize: decodedMetadata?.size ?? 0,
      fileName: '',
      pinnedObjects: true,
    }),
    [id, decodedMetadata, sharedObject.data]
  )

  const handleAddToDatabase = useCallback(async () => {
    if (!sharedObject.data || !sdk) return
    const decodedMetadata = decodeFileMetadata(sharedObject.data.meta)
    const pinnedObject: PinnedObject = {
      key: sharedObject.data.key,
      slabs: sharedObject.data.slabs.map((sharedSlab) => ({
        id: sharedSlab.slabId,
        offset: sharedSlab.offset,
        length: sharedSlab.length,
      })),
      metadata: sharedObject.data.meta ?? new ArrayBuffer(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const size = pinnedObject.slabs.reduce((acc, slab) => acc + slab.length, 0)
    await sdk.saveObject(pinnedObject)

    await createFileRecord({
      id,
      fileSize: size,
      createdAt: new Date().getTime(),
      fileName: '',
      fileType: decodedMetadata?.fileType ?? '',
      pinnedObjects: { [indexerURL]: pinnedObject },
      encryptionKey: encryptionKeyArrayBufferToHex(
        sharedObject.data.encryptionKey
      ),
    })
    toast.show('File added')
    navigation.navigate('FileDetail', { id })
  }, [
    sharedObject.data,
    sdk,
    indexerURL,
    toast,
    navigation,
    id,
    decodedMetadata,
  ])

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {sharedObject.isValidating ? (
          <View style={styles.center}>
            <ActivityIndicator color="#0969da" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : sharedObject.error ? (
          <Text style={styles.errorText}>{sharedObject.error.message}</Text>
        ) : (
          <>
            {shareUrl && <FileDetailsImport file={file} shareUrl={shareUrl} />}
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
