import { logger } from './logger'

const intervalMap = new Map<string, NodeJS.Timeout>()

export function createServiceInterval({
  name,
  worker,
  getState,
  interval,
}: {
  name: string
  worker: () => void
  getState: () => Promise<boolean>
  interval: number
}): () => void {
  const init = () => {
    if (intervalMap.get(name)) {
      clearInterval(intervalMap.get(name))
      intervalMap.delete(name)
    }
    logger.log(`[${name}] initializing`)
    intervalMap.set(
      name,
      setInterval(async () => {
        const enabled = await getState()
        if (!enabled) return
        worker()
      }, interval)
    )
  }

  return init
}
