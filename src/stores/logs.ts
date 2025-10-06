import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { useEffect } from 'react'
import { logger } from '../lib/logger'

export type LogsState = {
  logs: string[]
  append: (...args: unknown[]) => void
  clear: () => void
}

export const useLogsStore = create<LogsState>((set) => ({
  logs: [],
  append: (...args: unknown[]) =>
    set((state) => {
      const line = `${new Date().toLocaleTimeString()} ${args
        .map(String)
        .join(' ')}`
      const next = [...state.logs.slice(-100), line]
      return { logs: next }
    }),
  clear: () => set({ logs: [] }),
}))

// actions

export function appendLogLine(...args: unknown[]): void {
  useLogsStore.getState().append(...args)
}

export function clearLogs(): void {
  useLogsStore.getState().clear()
}

// selectors

export function useLogs(): string[] {
  return useLogsStore(useShallow((s) => s.logs))
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

export function useInitLogger(): void {
  useEffect(() => {
    initLogger()
  }, [])
}
