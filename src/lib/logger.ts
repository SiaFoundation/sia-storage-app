export const rustLogger = {
  hasInitialized: false,
  debug: (message: string) => {
    logger.sdk('[rust][debug]', message)
  },
  info: (message: string) => {
    logger.sdk('[rust][info]', message)
  },
  warn: (message: string) => {
    logger.sdk('[rust][warn]', message)
  },
  error: (message: string) => {
    logger.sdk('[rust][error]', message)
  },
}

// Flip this to false locally to silence service logs in dev.
// Saving this file likely crashes your dev app.
const logServices = true

export const logger = {
  log: (...args: any[]) => {
    console.log(...args)
  },
  sdk: (...args: any[]) => {
    console.log(...args)
  },
  clear: () => {},
}

/**
 * Logs messages from background services and periodic tasks.
 * In development mode, logging can be toggled using the `logServices` flag.
 * In production, all service logs are always output.
 */
export const serviceLog = (...args: any[]) => {
  if (!__DEV__ || logServices) {
    logger.log(...args)
  }
}
