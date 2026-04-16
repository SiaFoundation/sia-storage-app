import * as clack from '@clack/prompts'
import { execFile } from 'child_process'
import { hexToUint8 } from '@siastorage/core'
import { APP_META } from '@siastorage/core/config'
import { createCliAppService, isTestMode, type CliApp } from '../app'
import { c } from '../lib/format'

const DEFAULT_INDEXER_URL = 'https://sia.storage'

export async function connectCommand(dataDir: string) {
  const app = await createCliAppService(dataDir)

  try {
    if (isTestMode) {
      await runTestModeConnect(app)
      return
    }

    await runInteractiveConnect(app)
  } finally {
    app.db.close?.()
    // Force exit: the NAPI Builder has no dispose method to release its
    // native handle, so the event loop won't drain. All work is committed.
    process.exit(0)
  }
}

async function runTestModeConnect(app: CliApp) {
  const indexerUrl = DEFAULT_INDEXER_URL
  const appMetaJson = JSON.stringify(APP_META)

  await app.service.auth.builder.create(indexerUrl, appMetaJson)
  await app.service.auth.builder.requestConnection()
  await app.service.auth.builder.waitForApproval()

  const phrase = await app.service.auth.generateRecoveryPhrase()
  const appKeyHex = await app.service.auth.builder.register(phrase)

  await app.service.auth.setAppKey(indexerUrl, hexToUint8(appKeyHex))
  await app.service.settings.setIndexerURL(indexerUrl)
  await app.service.settings.setHasOnboarded(true)

  console.log(c.green('Connected successfully!'))
}

async function runInteractiveConnect(app: CliApp) {
  if (!(await confirmOverwriteIfOnboarded(app))) return

  const indexerUrl = await promptIndexerUrl()
  if (!indexerUrl) return

  if (!(await runApprovalFlow(app, indexerUrl))) return

  const mnemonic = await capturePhrase(app)
  if (!mnemonic) return

  await registerAndPersist(app, indexerUrl, mnemonic)
}

async function confirmOverwriteIfOnboarded(app: CliApp): Promise<boolean> {
  const hasOnboarded = await app.service.settings.getHasOnboarded()
  if (!hasOnboarded) return true

  const shouldContinue = await clack.confirm({
    message: 'Already connected. Overwrite existing configuration?',
  })
  if (clack.isCancel(shouldContinue) || !shouldContinue) {
    console.log(c.dim('Cancelled'))
    return false
  }
  return true
}

async function promptIndexerUrl(): Promise<string | undefined> {
  const indexerUrl = await clack.text({
    message: 'Indexer URL',
    initialValue: DEFAULT_INDEXER_URL,
    validate: (v) => {
      if (!v) return 'URL is required'
      try {
        new URL(v)
      } catch {
        return 'Invalid URL'
      }
    },
  })
  if (clack.isCancel(indexerUrl)) return undefined
  return indexerUrl
}

async function runApprovalFlow(app: CliApp, indexerUrl: string): Promise<boolean> {
  const appMetaJson = JSON.stringify(APP_META)
  await app.service.auth.builder.create(indexerUrl, appMetaJson)
  const approvalUrl = await app.service.auth.builder.requestConnection()

  console.log()
  console.log('Open this URL to approve the connection:')
  console.log(c.cyan(approvalUrl))
  console.log()

  openInBrowser(approvalUrl)

  const spinner = clack.spinner()
  spinner.start('Waiting for approval...')
  try {
    await app.service.auth.builder.waitForApproval()
    spinner.stop('Approved!')
    return true
  } catch {
    spinner.stop('Approval failed or cancelled')
    return false
  }
}

function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? (['open', [url]] as const)
      : process.platform === 'win32'
        ? (['cmd', ['/c', 'start', '""', url]] as const)
        : (['xdg-open', [url]] as const)
  try {
    execFile(cmd, [...args])
  } catch {
    // Browser open failed; user can copy the URL manually.
  }
}

async function capturePhrase(app: CliApp): Promise<string | undefined> {
  const phraseAction = await clack.select({
    message: 'Recovery phrase',
    options: [
      { value: 'generate', label: 'Generate new recovery phrase' },
      { value: 'import', label: 'Enter existing recovery phrase' },
    ],
  })
  if (clack.isCancel(phraseAction)) return undefined

  if (phraseAction === 'generate') {
    const mnemonic = await app.service.auth.generateRecoveryPhrase()
    printRecoveryPhrase(mnemonic)
    return mnemonic
  }

  const phrase = await clack.text({
    message: 'Enter your 12-word recovery phrase',
    validate: (v) => {
      if (!v) return 'Phrase is required'
      const words = v.trim().split(/\s+/)
      if (words.length !== 12) return 'Recovery phrase must be 12 words'
    },
  })
  if (clack.isCancel(phrase)) return undefined
  const mnemonic = phrase.trim()

  try {
    await app.service.auth.validateRecoveryPhrase(mnemonic)
  } catch {
    console.error(c.red('Invalid recovery phrase'))
    return undefined
  }
  return mnemonic
}

function printRecoveryPhrase(mnemonic: string): void {
  console.log()
  console.log(c.bold('Recovery Phrase (save this securely):'))
  console.log()
  const words = mnemonic.split(' ')
  for (let row = 0; row < 3; row++) {
    const line = words
      .slice(row * 4, row * 4 + 4)
      .map((w, i) => `${c.dim(`${row * 4 + i + 1}.`)} ${w}`)
      .join('  ')
    console.log(`  ${line}`)
  }
  console.log()
}

async function registerAndPersist(
  app: CliApp,
  indexerUrl: string,
  mnemonic: string,
): Promise<void> {
  const spinner = clack.spinner()
  spinner.start('Registering...')
  try {
    const appKeyHex = await app.service.auth.builder.register(mnemonic)
    await app.service.auth.setAppKey(indexerUrl, hexToUint8(appKeyHex))
    await app.service.settings.setIndexerURL(indexerUrl)
    await app.service.settings.setHasOnboarded(true)

    spinner.stop('Registered!')
    console.log()
    console.log(c.green('Connected successfully!'))
    console.log(c.dim('Run "sia daemon start" to begin syncing'))
  } catch (e) {
    spinner.stop('Registration failed')
    console.error(e instanceof Error ? e.message : String(e))
  }
}
