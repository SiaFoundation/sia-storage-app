import {
  setSecureStoreBoolean,
  getSecureStoreBoolean,
  setSecureStoreString,
  getSecureStoreString,
} from './secureStore'
import { setSecureStoreNumber, getSecureStoreNumber } from './secureStore'
import { createGetterAndSWRHook } from '../lib/selectors'
import { buildSWRHelpers } from '../lib/swr'
import { setTransfersMaxSlots } from '../managers/transfersPool'
import { DEFAULT_INDEXER_URL, DEFAULT_MAX_TRANSFERS } from '../config'
import { logger } from '../lib/logger'
import { generateRecoveryPhrase } from 'react-native-sia'

const { getKey, triggerChange } = buildSWRHelpers('secureStore')

// Recovery Phrase

export const [getRecoveryPhrase, useRecoveryPhrase] = createGetterAndSWRHook(
  getKey('recoveryPhrase'),
  async (): Promise<string> => {
    const recoveryPhrase = await getSecureStoreString('recoveryPhrase')
    if (!recoveryPhrase) {
      const newRecoveryPhrase = generateRecoveryPhrase()
      await setRecoveryPhrase(newRecoveryPhrase)
      return newRecoveryPhrase
    }
    return recoveryPhrase
  }
)

export async function setRecoveryPhrase(
  recoveryPhrase: string
): Promise<boolean> {
  try {
    await setSecureStoreString('recoveryPhrase', recoveryPhrase)
    triggerChange('recoveryPhrase')
    return true
  } catch {
    return false
  }
}

// Indexer

export const [getIndexerURL, useIndexerURL] = createGetterAndSWRHook(
  getKey('indexerURL'),
  () => getSecureStoreString('indexerURL', DEFAULT_INDEXER_URL)
)

export async function setIndexerURL(value: string) {
  await setSecureStoreString('indexerURL', value)
  triggerChange('indexerURL')
}

// Has Onboarded

export const [getHasOnboarded, useHasOnboarded] = createGetterAndSWRHook(
  getKey('hasOnboarded'),
  () => getSecureStoreBoolean('hasOnboarded')
)

export async function setHasOnboarded(value: boolean) {
  await setSecureStoreBoolean('hasOnboarded', value)
  triggerChange('hasOnboarded')
}

// Show Advanced

export async function setShowAdvanced(value: boolean) {
  await setSecureStoreBoolean('showAdvanced', value)
  triggerChange('showAdvanced')
}

export const [getShowAdvanced, useShowAdvanced] = createGetterAndSWRHook(
  getKey('showAdvanced'),
  () => getSecureStoreBoolean('showAdvanced')
)

// Max Transfers

export async function setMaxTransfers(value: number) {
  if (!value) {
    logger.log('[settings] setMaxTransfers: value must be 1 or greater')
  }
  const clamped = Math.max(1, Math.floor(Number(value) || 1))
  await setSecureStoreNumber('maxTransfers', clamped)
  setTransfersMaxSlots(clamped)
  triggerChange('maxTransfers')
}

export const [getMaxTransfers, useMaxTransfers] = createGetterAndSWRHook(
  getKey('maxTransfers'),
  () => getSecureStoreNumber('maxTransfers', DEFAULT_MAX_TRANSFERS)
)

// Auto Scan Uploads

export const [getAutoScanUploads, useAutoScanUploads] = createGetterAndSWRHook(
  getKey('autoScanUploads'),
  () => getSecureStoreBoolean('autoScanUploads')
)

export async function setAutoScanUploads(value: boolean) {
  await setSecureStoreBoolean('autoScanUploads', value)
  triggerChange('autoScanUploads')
}
