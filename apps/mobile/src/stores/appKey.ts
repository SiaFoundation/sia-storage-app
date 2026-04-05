import { AppKey, type AppKeyInterface } from 'react-native-sia'
import { app } from './appService'

/**
 * Get the AppKey for a specific indexer URL.
 * Wraps facade's Uint8Array in react-native-sia's AppKey type.
 */
export async function getAppKeyForIndexer(indexerURL: string): Promise<AppKey | undefined> {
  const bytes = await app().auth.getAppKey(indexerURL)
  return bytes ? new AppKey(bytes.buffer as ArrayBuffer) : undefined
}

/**
 * Get the AppKey for the currently active indexer.
 */
export async function getAppKey(): Promise<AppKey> {
  const indexerURL = await app().settings.getIndexerURL()
  const appKey = await getAppKeyForIndexer(indexerURL)
  if (!appKey) {
    throw new Error('AppKey not found for active indexer')
  }
  return appKey
}

/**
 * Set the AppKey for a specific indexer URL.
 * Converts react-native-sia's AppKeyInterface to Uint8Array for facade storage.
 */
export async function setAppKeyForIndexer(
  indexerURL: string,
  appKey: AppKeyInterface,
): Promise<void> {
  await app().auth.setAppKey(indexerURL, new Uint8Array(appKey.export_()))
}
