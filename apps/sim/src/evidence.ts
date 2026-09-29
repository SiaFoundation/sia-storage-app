/**
 * The record a session keeps of how a result was reached: every sim command
 * run against it, and what a device showed at a named moment. A fix that sim
 * found or reproduced hands both on, the commands as the steps to reproduce it
 * and the captures as what the steps showed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Device } from './devices'
import type { Session } from './session'

const COMMANDS = 'commands.log'

/** Quotes an argument for a POSIX shell only when it needs it. */
function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Appends a command, as the arguments after `sim`, to the session's log of them. */
export function recordCommand(session: Session, args: string[]): void {
  appendFileSync(
    join(session.dir, COMMANDS),
    `${JSON.stringify({ at: new Date().toISOString(), args })}\n`,
  )
}

/** The session's commands in order, as lines a shell can run again. */
export function transcript(session: Session): string[] {
  const file = join(session.dir, COMMANDS)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => `bun sim ${(JSON.parse(line) as { args: string[] }).args.map(quote).join(' ')}`)
}

/**
 * Saves what `device` shows now under `<session>/evidence/<label>/<device>`:
 * its library and the end of its log, a phone's screen, and whatever else the
 * device adds, such as the desktop app's windows and Finder folder. Returns
 * the directory.
 */
export async function capture(
  session: Session,
  name: string,
  device: Device,
  label: string,
): Promise<string> {
  const dir = join(session.dir, 'evidence', label.replace(/[^\w.-]+/g, '-'), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'library.json'), `${JSON.stringify(await device.library(), null, 2)}\n`)
  writeFileSync(join(dir, 'log.txt'), await device.logs(200))
  if (device.screenshot) await device.screenshot(join(dir, 'screen.png'))
  if (device.captureMore) await device.captureMore(dir)
  return dir
}
