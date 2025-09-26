import { setSecureStoreBoolean, getSecureStoreBoolean } from './secureStore'
import { createGetterAndSWRHook } from '../lib/selectors'
import { buildSWRHelpers } from '../lib/swr'

const { getKey, triggerChange } = buildSWRHelpers('secureStore')

export async function setShowAdvanced(value: boolean) {
  await setSecureStoreBoolean('showAdvanced', value)
  triggerChange('showAdvanced')
}

export const [getShowAdvanced, useShowAdvanced] = createGetterAndSWRHook(
  getKey('showAdvanced'),
  () => getSecureStoreBoolean('showAdvanced')
)
