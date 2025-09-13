export const rustLogger = {
  hasInitialized: false,
  debug: (message: string) => {
    logger.log('[rust][debug]', message)
  },
  info: (message: string) => {
    logger.log('[rust][info]', message)
  },
  warn: (message: string) => {
    logger.log('[rust][warn]', message)
  },
  error: (message: string) => {
    logger.log('[rust][error]', message)
  },
}

export const logger = {
  log: (...args: any[]) => {
    console.log(...args)
  },
  clear: () => {},
}
