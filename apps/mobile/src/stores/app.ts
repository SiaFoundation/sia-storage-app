import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'

export type InitStep = {
  id: string
  label: string
  message: string
  startedAt: number
}

type AppState = {
  steps: Map<string, InitStep>
  isInitializing: boolean
  initializationError: string | null
}

export const useAppStore = create<AppState>(() => {
  return {
    steps: new Map<string, InitStep>(),
    isInitializing: true,
    initializationError: null,
  }
})

export const { setState: setAppState } = useAppStore

export const [getInitSteps, useInitSteps] = createGetterAndSelector(
  useAppStore,
  (state) => {
    const steps = Array.from(state.steps.values())
    return steps.sort((a, b) => a.startedAt - b.startedAt)
  },
)

export const [getCurrentInitStep, useCurrentInitStep] = createGetterAndSelector(
  useAppStore,
  (state) => {
    const steps = Array.from(state.steps.values())
    return steps.sort((a, b) => a.startedAt - b.startedAt).at(-1)
  },
)

export const [getInitializationError, useInitializationError] =
  createGetterAndSelector(useAppStore, (state) => state.initializationError)

export const [getIsInitializing, useIsInitializing] = createGetterAndSelector(
  useAppStore,
  (s) => s.isInitializing,
)

export const [getShowSplash, useShowSplash] = createGetterAndSelector(
  useAppStore,
  (s) => s.isInitializing || s.initializationError,
)
