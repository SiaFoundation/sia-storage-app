import { logger } from '@siastorage/logger'
import { Alert, Share } from 'react-native'

export default async function shareLink({ url }: { url: string }) {
  try {
    const result = await Share.share({
      message: url,
    })
    if (result.action === Share.sharedAction) {
      if (result.activityType) {
        logger.debug('shareLink', 'shared', {
          activityType: result.activityType,
        })
        // shared with activity type of result.activityType
      } else {
        // shared
      }
    } else if (result.action === Share.dismissedAction) {
      // dismissed
    }
  } catch (error: any) {
    Alert.alert(error.message)
  }
}
