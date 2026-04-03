import useSWR from 'swr'
import { useApp } from '../app/context'
import { useSyncGateStatus } from './sync'

/** Returns the full app initialization state including steps and errors. */
export function useInitState() {
  const app = useApp()
  return useSWR(app.caches.init.key(), () => app.init.getState())
}

/** Returns whether the app is currently initializing, defaults to true until state loads. */
export function useIsInitializing() {
  const { data } = useInitState()
  return data?.isInitializing ?? true
}

/** Returns whether the splash screen should be shown during init or on error. */
export function useShowSplash() {
  const { data } = useInitState()
  const syncGateStatus = useSyncGateStatus()
  if (!data) return true
  return (
    data.isInitializing ||
    !!data.initializationError ||
    syncGateStatus === 'pending' ||
    syncGateStatus === 'active'
  )
}

/** Returns all initialization steps sorted by start time. */
export function useInitSteps() {
  const { data } = useInitState()
  if (!data) return []
  return Object.values(data.steps).sort((a, b) => a.startedAt - b.startedAt)
}

/** Returns the most recently started initialization step, or null if none. */
export function useCurrentInitStep() {
  const steps = useInitSteps()
  return steps.at(-1) ?? null
}

/** Returns the initialization error message if startup failed, or null. */
export function useInitializationError() {
  const { data } = useInitState()
  return data?.initializationError ?? null
}
