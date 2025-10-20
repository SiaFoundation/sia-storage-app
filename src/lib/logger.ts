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

export const logger = {
  log: (...args: any[]) => {
    console.log(...args)
  },
  sdk: (...args: any[]) => {
    console.log(...args)
  },
  clear: () => {},
}
