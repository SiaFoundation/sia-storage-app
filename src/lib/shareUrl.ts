import { PinnedObjectInterface, Sdk } from 'react-native-sia'

export function generateSiaShareUrl(
  sdk: Sdk,
  pinnedObject: PinnedObjectInterface,
  expiresAt: Date
) {
  const shareUrl = sdk.shareObject(pinnedObject, expiresAt)
  return shareUrl.replace(/https?:\/\//, 'sia://')
}

export function convertSiaShareUrlToHttp(shareUrl?: string) {
  if (!shareUrl) return null
  if (shareUrl.startsWith('sia://')) {
    return shareUrl.replace('sia://', 'https://')
  }
  return shareUrl
}
