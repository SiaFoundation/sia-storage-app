import { Alert, Share } from 'react-native'
import { logger } from '../lib/logger'

export default async function shareLink({ url }: { url: string }) {
  try {
    const result = await Share.share({
      message: url,
    })
    if (result.action === Share.sharedAction) {
      if (result.activityType) {
        logger.log(result.activityType)
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
