import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { useEffect } from 'react'
import { logger } from '../lib/logger'

export type LogsState = {
  logs: string[]
}

export const useLogsStore = create<LogsState>(() => ({
  logs: [],
}))

const { setState } = useLogsStore

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

export function initLogger(): void {
  if (hasInit) {
    logger.log('[logs] initLogger already called, skipping')
    return
  }
  logger.log('[logs] initLogger called')
  // Wire the global logger to the logs store and console once.
  logger.log = (...args: unknown[]) => {
    console.log(...args)
    appendLogLine(...args)
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
