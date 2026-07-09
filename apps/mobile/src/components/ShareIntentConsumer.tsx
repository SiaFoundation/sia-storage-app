import { useHasOnboarded } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import { useShareIntentContext } from 'expo-share-intent'
import { useEffect } from 'react'
import { captureSharedFiles } from '../lib/importCapture'
import { importFiles } from '../lib/importFiles'
import { showImportResultToast } from '../lib/importResultToast'
import { useToast } from '../lib/toastContext'

export function ShareIntentConsumer() {
  const { data: hasOnboarded } = useHasOnboarded()
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext()
  const toast = useToast()

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return
    if (!hasOnboarded) {
      toast.show('Finish setup before importing shared files.')
      return
    }

    const handleShareIntent = async () => {
      try {
        const files = (shareIntent.files ?? []).filter((file) => file?.path)
        if (files.length === 0) {
          logger.debug('shareIntent', 'no_supported_files')
          toast.show('No shareable files found.')
          return
        }

        const imported = await importFiles(
          await captureSharedFiles(
            files.map((file) => ({
              id: undefined,
              name: file.fileName ?? 'Shared File',
              size: file.size ?? undefined,
              type: file.mimeType,
              timestamp: new Date().toISOString(),
              sourceUri: file.path,
            })),
          ),
          'file',
          {},
          'share',
        )
        showImportResultToast(toast, imported)
      } catch (error) {
        logger.error('shareIntent', 'process_failed', { error: error as Error })
        toast.show('Failed to import shared files.')
      } finally {
        resetShareIntent()
      }
    }

    void handleShareIntent()
  }, [hasOnboarded, hasShareIntent, shareIntent, resetShareIntent, toast])

  return null
}
