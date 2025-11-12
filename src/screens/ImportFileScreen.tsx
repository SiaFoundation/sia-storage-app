import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  type ImportStackParamList,
  type RootTabParamList,
} from '../stacks/types'
import { useToast } from '../lib/toastContext'
import { useSdk } from '../stores/sdk'
import {
  createFileRecordWithLocalObject,
  FileLocalMetadata,
  FileMetadata,
  FileRecord,
  readFileRecordByContentHash,
} from '../stores/files'
import { FileDetailsImport } from '../components/FileDetailsImport'
import { logger } from '../lib/logger'
import {
  decodeFileMetadata,
  hasCompleteFileMetadata,
  transformFileMetadata,
} from '../encoding/fileMetadata'
import { getIndexerURL } from '../stores/settings'
import { BottomActionButton } from '../components/BottomActionButton'
import { PlusIcon } from 'lucide-react-native'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { colors } from '../styles/colors'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { convertSiaShareUrlToHttp } from '../lib/shareUrl'

type Props = NativeStackScreenProps<ImportStackParamList, 'ImportFile'>

export function ImportFileScreen({ route }: Props) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>()
  const toast = useToast()
  const id = route.params.id
  const shareUrl = convertSiaShareUrlToHttp(route.params.shareUrl)
  const sdk = useSdk()
  const sharedObject = useSWR(
    sdk ? ['sharedObject', shareUrl, id] : null,
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
  const sharedFile = useMemo(() => {
    if (!sharedObject.data) return null
    const metadata = decodeFileMetadata(sharedObject.data.metadata())
    const fileMetadata: FileMetadata = transformFileMetadata({
      ...metadata,
      size: Number(sharedObject.data.size()),
    })
    const localMetadata: FileLocalMetadata = {
      id,
      localId: null,
      addedAt: Date.now(),
    }
    const file: FileRecord = {
      ...fileMetadata,
      ...localMetadata,
      objects: {},
    }
    return file
  }, [sharedObject.data, id])

  const [isAddingToDatabase, setIsAddingToDatabase] = useState(false)
  const handleAddToDatabase = useCallback(async () => {
    setIsAddingToDatabase(true)
    try {
      if (!sharedObject.data || !sdk || !sharedFile) {
        toast.show('Error adding file to library')
        return
      }
      logger.log('[ImportFileScreen] handleAddToDatabase', sharedFile.id)
      if (!hasCompleteFileMetadata(sharedFile)) {
        toast.show('Shared file must have complete metadata')
        return
      }
      const existingFile = await readFileRecordByContentHash(sharedFile.hash)
      if (existingFile) {
        toast.show('File already exists in library')
        return
      }
      const indexerURL = await getIndexerURL()
      const pinnedObject = await sdk.pinShared(sharedObject.data)
      const localObject = await pinnedObjectToLocalObject(
        sharedFile.id,
        indexerURL,
        pinnedObject
      )
      await createFileRecordWithLocalObject(sharedFile, localObject)
      toast.show('File added')
      navigation.navigate('MainTab', {
        screen: 'FileDetail',
        params: { id: sharedFile.id },
      })
    } catch (e) {
      logger.log('[ImportFileScreen] Error adding file to library', e)
      toast.show('Error adding file to library')
    } finally {
      setIsAddingToDatabase(false)
    }
  }, [sharedFile, sdk, toast, navigation])

  return (
    <View style={styles.container}>
      <FileDetailScreenHeader
        title="Import File"
        navigation={navigation}
        icon="close"
      />
      <ScrollView contentContainerStyle={styles.content}>
        {sharedObject.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accentPrimary} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : sharedObject.error ? (
          <Text style={styles.errorText}>{sharedObject.error.message}</Text>
        ) : (
          <>
            {shareUrl && sharedFile && (
              <FileDetailsImport file={sharedFile} shareUrl={shareUrl} />
            )}
          </>
        )}
      </ScrollView>
      <BottomActionButton
        label={isAddingToDatabase ? 'Adding to library...' : 'Add to library'}
        disabled={isAddingToDatabase}
        icon={<PlusIcon color="white" size={22} />}
        onPress={handleAddToDatabase}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  content: { padding: 0 },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  loadingText: { color: colors.textSecondary, marginTop: 8 },
  errorText: { color: colors.textDanger },
})
