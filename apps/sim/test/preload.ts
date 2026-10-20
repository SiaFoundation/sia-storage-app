/**
 * Gives the sim tests their own SIM_HOME. Tests that create sessions would
 * otherwise write them beside the sessions people run on this Mac, and the
 * live-session checks would find a real `bun sim up --live` session and fail.
 *
 * session.ts reads SIM_HOME once, when it is first imported, so this has to
 * run before any test file loads. The directory stays under /tmp, as the real
 * one does, because a CLI device's socket path inside it is capped at 104
 * bytes on macOS.
 */
import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'

const home = mkdtempSync('/tmp/sia-sim-test-')
process.env.SIM_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))
