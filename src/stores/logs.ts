import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../lib/logger'
import { createGetterAndSelector } from '../lib/selectors'
import { getAsyncStorageBoolean, setAsyncStorageBoolean } from './asyncStore'

export type LogsState = {
  logs: string[]
  enableSdkLogs: boolean
}

export const useLogsStore = create<LogsState>(() => ({
  logs: [],
  enableSdkLogs: false,
}))

const { setState, getState } = useLogsStore

export function appendLogLine(...args: unknown[]): void {
  setState((state) => {
    const line = `${new Date().toLocaleTimeString()} ${args
      .map(String)
      .join(' ')}`
    const next = [...state.logs.slice(-100), line]
    return { logs: next }
  })
}

export function clearLogs(): void {
  setState(() => {
    return { logs: [] }
  })
}

let hasInit = false

export async function initLogger(): Promise<void> {
  if (hasInit) {
    logger.log('[logs] initLogger already called, skipping')
    return
  }
  logger.log('[logs] initLogger called')

  // Init state with secure store value so that we can use an in memory value
  // in the logger callbacks.
  const enableSdkLogs = await getEnableSdkLogs()
  setState((state) => {
    return { ...state, enableSdkLogs }
  })

  // Wire the global logger to the logs store.
  logger.log = (...args: unknown[]) => {
    console.log(...args)
    appendLogLine(...args)
  }
  logger.sdk = (...args: unknown[]) => {
    const state = getState()
    if (state.enableSdkLogs) {
      console.log(...args)
      appendLogLine(...args)
    }
  }
  logger.clear = () => {
    clearLogs()
  }
  hasInit = true
}

// selectors

export function useLogs(): string[] {
  return useLogsStore(useShallow((s) => s.logs))
}

// Get the enable SDK logs flag from the store state.
export const [getSDKLogsEnabled, useSDKLogsEnabled] = createGetterAndSelector(
  useLogsStore,
  (state) => state.enableSdkLogs
)

// Get the enable SDK logs flag from the secure store.
export async function getEnableSdkLogs(): Promise<boolean> {
  return getAsyncStorageBoolean('enableSdkLogs', false)
}

// Set the enable SDK logs flag in both the async store and the store state.
export async function setEnableSdkLogs(value: boolean): Promise<void> {
  await setAsyncStorageBoolean('enableSdkLogs', value)
  setState((state) => {
    return { ...state, enableSdkLogs: value }
  })
}

// Toggle the enable SDK logs flag in both the secure store and the store state.
export async function toggleEnableSdkLogs(): Promise<void> {
  const value = !getSDKLogsEnabled()
  await setEnableSdkLogs(value)
}
