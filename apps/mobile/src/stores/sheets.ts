import { swrCache } from '@siastorage/core/stores'
import useSWR from 'swr'

const cache = swrCache()
let openName = ''

export function openSheet(name: string): void {
  openName = name
  cache.invalidate()
}

export async function closeSheet(name?: string): Promise<void> {
  if (name && openName !== name) return
  openName = ''
  cache.invalidate()
  await new Promise((resolve) => setTimeout(resolve, 220))
}

export function resetSheets(): void {
  openName = ''
  cache.invalidate()
}

export function useSheetOpen(name: string): boolean {
  const { data } = useSWR(cache.key(), () => ({ openName }))
  return data?.openName === name
}
