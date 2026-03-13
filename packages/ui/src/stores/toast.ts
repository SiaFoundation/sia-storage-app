import { swrCache } from '@siastorage/core/stores/swr'
import useSWR from 'swr'

type Toast = {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

const cache = swrCache()

let toasts: Toast[] = []
let nextId = 0

export function addToast(message: string, type: Toast['type'] = 'success') {
  const id = String(++nextId)
  toasts = [...toasts, { id, message, type }]
  cache.invalidate()
  setTimeout(() => {
    removeToast(id)
  }, 3000)
}

export function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id)
  cache.invalidate()
}

const actions = { addToast, removeToast }

type ToastFull = { toasts: Toast[] } & typeof actions

function getState(): ToastFull {
  return { toasts, ...actions }
}

function useToastStoreImpl<T>(selector: (s: ToastFull) => T): T {
  const { data } = useSWR(cache.key(), () => toasts)
  const current = data ?? toasts
  return selector({ toasts: current, ...actions })
}

export const useToastStore: typeof useToastStoreImpl & {
  getState: typeof getState
} = Object.assign(useToastStoreImpl, { getState })
