import { logger } from '../lib/logger'
import BackgroundFetch from 'react-native-background-fetch'
import { getNextUploads } from './uploadScanner'
import { queueUploadForFileId } from './uploader'

export async function initBackgroundTasks() {
  logger.log(`[backgroundTask] init`)

  let status = await BackgroundFetch.configure(
    {
      minimumFetchInterval: 15,
      requiredNetworkType: BackgroundFetch.NETWORK_TYPE_UNMETERED,
      requiresBatteryNotLow: true,
      requiresCharging: false,
      requiresDeviceIdle: false,
      startOnBoot: true,
      stopOnTerminate: false,
    },
    async (taskId: string) => {
      logger.log(`[backgroundTask/event] ${taskId}`)
      try {
        const [file] = await getNextUploads(1)
        await queueUploadForFileId(file.id)
      } catch (e) {
        logger.log(`[backgroundTask/event] error: ${e}`)
      } finally {
        BackgroundFetch.finish(taskId)
      }
    },
    (taskId: string) => {
      logger.log(`[backgroundTask/timeout] ${taskId}`)
      BackgroundFetch.finish(taskId)
    }
  )

  logger.log('[backgroundTask] configure status: ', status)
}
