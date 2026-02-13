import { logger } from './logger'

declare const ErrorUtils: {
  getGlobalHandler(): (error: Error, isFatal?: boolean) => void
  setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void
}

let installed = false

export function installGlobalErrorHandler() {
  if (installed) return
  if (typeof ErrorUtils === 'undefined') return
  installed = true

  const defaultHandler = ErrorUtils.getGlobalHandler()

  ErrorUtils.setGlobalHandler((error, isFatal) => {
    logger.error('app', 'uncaught_js_error', {
      error,
      isFatal: isFatal ?? false,
    })
    defaultHandler(error, isFatal)
  })
}
