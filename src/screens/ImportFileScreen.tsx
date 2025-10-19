import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import React, { useCallback } from 'react'
import useSWR from 'swr'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native'
import {
  type ImportStackParamList,
  type RootTabParamList,
} from '../stacks/types'
import { useToast } from '../lib/toastContext'
import { useSdk } from '../stores/sdk'
import { createFileRecord } from '../stores/files'
import { uniqueId } from '../lib/uniqueId'
import { FileDetailsImport } from '../components/FileDetailsImport'
import { logger } from '../lib/logger'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { getIndexerURL } from '../stores/settings'
import { BottomActionButton } from '../components/BottomActionButton'
import { PlusIcon } from 'lucide-react-native'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { colors } from '../styles/colors'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { upsertLocalObject } from '../stores/localObjects'

type Props = NativeStackScreenProps<ImportStackParamList, 'ImportFile'>

export function ImportFileScreen({ route }: Props) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>()
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
    const localObject = await pinnedObjectToLocalObject(
      sharedFile.data.id,
      indexerURL,
      pinnedObject
    )
    await createFileRecord({
      ...sharedFile.data,
      createdAt: new Date().getTime(),
      updatedAt: new Date().getTime(),
    })
    await upsertLocalObject(localObject)
    toast.show('File added')
    navigation.navigate('MainTab', {
      screen: 'FileDetail',
      params: { id: sharedFile.data.id },
    })
  }, [sharedFile.data, sdk, toast, navigation])

  return (
    <View style={styles.container}>
      <FileDetailScreenHeader
        title="Import File"
        navigation={navigation}
        icon="close"
      />
      <ScrollView contentContainerStyle={styles.content}>
        {sharedFile.isValidating ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accentPrimary} />
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
      <BottomActionButton
        label="Add to library"
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
  footer: { padding: 16 },
  title: {
    color: colors.textTitleDark,
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 12,
  },
  linkRow: { marginBottom: 12 },
  link: { color: colors.accentPrimary },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  loadingText: { color: colors.textSecondary, marginTop: 8 },
  errorText: { color: colors.textDanger },
  card: {
    maxHeight: 200,
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    borderColor: colors.borderMutedLight,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  mono: {
    color: colors.textTitleDark,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
  },
})
