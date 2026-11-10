/*
 * Sets up a macOS CI runner for the desktop sim scenarios. Nobody is at a
 * runner to answer macOS's prompts or flip switches in System Settings, so
 * this grants the privacy permissions sim needs and switches the test app's
 * Finder folder on. When the grants do not take, `grant` prints what macOS
 * allowed.
 *
 *   bun scripts/macos-ci-setup.ts grant --app <bundle id>
 *   bun scripts/macos-ci-setup.ts enable-file-provider --ext <bundle id>
 *   bun scripts/macos-ci-setup.ts report
 *
 * sim drives the app's menu bar icon and dialogs through System Events, which
 * needs Accessibility and Automation of System Events, quits the app with an
 * Apple event, which needs Automation of the app, and reads the Finder folder
 * under ~/Library/CloudStorage, which needs Full Disk Access. macOS decides
 * each one for the "responsible" process, which for a CI step is whichever
 * ancestor launchd started (the runner's agent or a script it runs), not bun
 * or the shell. So `grant` writes a row for every executable in this
 * process's ancestry, and `report` prints that ancestry beside tccd's log
 * lines, which name the process macOS checked.
 *
 * Grants are rows in the TCC databases. Accessibility and Full Disk Access
 * live in the system database, Automation in the user's. Writing either needs
 * root, and the writing process must itself hold Full Disk Access or have SIP
 * off, since tccd protects the files rather than SIP's file flags. GitHub's
 * macOS images run with SIP off. On macOS 27 the user database moved from
 * ~/Library into a ProtectedSystem container, which `userDatabase` finds the
 * way GitHub's own image build does.
 *
 * Both the TCC databases and fileproviderd's Domains.plist are undocumented
 * storage, so a macOS release can move them. When it does, `grant` or
 * `enable-file-provider` exits non-zero rather than leaving sim to time out.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SYSTEM_DB = '/Library/Application Support/com.apple.TCC/TCC.db'
const PROTECTED_SYSTEM = '/private/var/containers/Data/ProtectedSystem'

type Run = { code: number; out: string; err: string }

function run(cmd: string[], opts: { input?: string; timeoutMs?: number } = {}): Run {
  const p = Bun.spawnSync(cmd, {
    stdin: opts.input === undefined ? 'ignore' : Buffer.from(opts.input),
    timeout: opts.timeoutMs ?? 30_000,
  })
  return {
    code: p.exitCode ?? -1,
    out: p.stdout.toString().trim(),
    err: p.stderr.toString().trim(),
  }
}

const canSudo = run(['sudo', '-n', 'true']).code === 0
const asRoot = (cmd: string[]) => (canSudo ? ['sudo', '-n', ...cmd] : cmd)

/**
 * Every ancestor of this process up to launchd, nearest first: its executable
 * and any script files among its arguments. A launchd job that runs a script
 * shows as its interpreter, and TCC may hold the script as the client. The
 * rest of the command line is dropped, since a runner agent's can carry its
 * registration token and this output lands in a public job log.
 */
function ancestry(): Array<{ pid: number; path: string; scripts: string[] }> {
  const chain = []
  for (let pid = process.pid; pid > 1;) {
    const row = run(['ps', '-o', 'ppid=,comm=', '-p', String(pid)]).out
    const match = /^\s*(\d+)\s+(.*)$/.exec(row)
    if (!match) break
    const scripts = run(['ps', '-o', 'command=', '-p', String(pid)])
      .out.split(/\s+/)
      .filter((arg) => /^\/\S+\.(sh|js)$/.test(arg) && existsSync(arg))
    chain.push({ pid, path: match[2]!, scripts })
    pid = Number(match[1])
  }
  return chain
}

/**
 * The user TCC database tccd has open. Before macOS 27 it is in ~/Library.
 * From 27 it sits six levels under the ProtectedSystem container, and when
 * more than one container holds one, the live one is the file tccd has open.
 */
function userDatabase(): string | null {
  const legacy = join(process.env.HOME ?? '', 'Library/Application Support/com.apple.TCC/TCC.db')
  if (existsSync(legacy)) return legacy
  const found = run(
    asRoot([
      'find',
      PROTECTED_SYSTEM,
      '-mindepth',
      '6',
      '-maxdepth',
      '6',
      '-type',
      'f',
      '-path',
      '*/Data/Library/Application Support/com.apple.TCC/TCC.db',
    ]),
  )
    .out.split('\n')
    .filter(Boolean)
  if (found.length <= 1) return found[0] ?? null
  const open = run(asRoot(['lsof', '-c', 'tccd', '-Fn'])).out
  return found.find((db) => open.includes(`n${db}`)) ?? null
}

function sqlite(db: string, query: string): Run {
  return run(asRoot(['sqlite3', db, query]))
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`

/**
 * The client's designated requirement as the blob TCC stores, so a grant
 * names the signed binary rather than whatever sits at the path. An unsigned
 * client, such as a shell script a launchd job runs, gets NULL, which TCC
 * accepts for a path client.
 */
function csreq(path: string): string {
  const shown = run(['codesign', '-d', '-r-', path])
  const requirement = /designated => (.*)/.exec(`${shown.out}\n${shown.err}`)?.[1]
  if (!requirement) return 'NULL'
  const dir = mkdtempSync(join(tmpdir(), 'csreq-'))
  try {
    const blob = join(dir, 'req.bin')
    if (run(['csreq', '-r-', '-b', blob], { input: requirement }).code !== 0) return 'NULL'
    return `X'${readFileSync(blob).toString('hex')}'`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

type Checks = { accessibility: string; automationSystemEvents: string; fullDiskAccess: string }

/**
 * What this process is allowed, tested by doing each thing sim does. A
 * missing Automation consent can raise a prompt nobody answers, so that test
 * has a timeout and reports one as "timed out". Reading the system TCC
 * database is itself gated on Full Disk Access.
 */
function checks(): Checks {
  const accessibility = run([
    'osascript',
    '-l',
    'JavaScript',
    '-e',
    "ObjC.import('ApplicationServices'); $.AXIsProcessTrusted()",
  ])
  const systemEvents = run(
    ['osascript', '-e', 'tell application "System Events" to count processes'],
    { timeoutMs: 20_000 },
  )
  let fullDiskAccess: string
  try {
    readFileSync(SYSTEM_DB).subarray(0, 16)
    fullDiskAccess = 'yes'
  } catch (e) {
    fullDiskAccess = `no (${(e as Error).message})`
  }
  return {
    accessibility: accessibility.code === 0 ? accessibility.out : `error: ${accessibility.err}`,
    automationSystemEvents:
      systemEvents.code === 0
        ? 'yes'
        : systemEvents.code === -1
          ? 'timed out'
          : `no: ${systemEvents.err}`,
    fullDiskAccess,
  }
}

const passed = (c: Checks) =>
  c.accessibility === 'true' && c.automationSystemEvents === 'yes' && c.fullDiskAccess === 'yes'

/** tccd's lines from the last few minutes that say which process it checked and what it decided. */
function attribution(): string[] {
  return run(
    [
      'log',
      'show',
      '--last',
      '3m',
      '--info',
      '--style',
      'compact',
      '--predicate',
      'subsystem == "com.apple.TCC"',
    ],
    { timeoutMs: 60_000 },
  )
    .out.split('\n')
    .filter((l) => /AUTHREQ|responsible|attribution|denied|Prompting/i.test(l))
    .slice(-40)
}

function grants(db: string | null): string {
  if (!db) return 'not found'
  const r = sqlite(
    db,
    `SELECT service, client, auth_value, indirect_object_identifier FROM access
       WHERE service IN ('kTCCServiceAccessibility', 'kTCCServiceSystemPolicyAllFiles', 'kTCCServiceAppleEvents')
       ORDER BY service, client`,
  )
  return r.code === 0 ? r.out : `unreadable: ${r.err}`
}

function report(): void {
  console.log(
    JSON.stringify(
      {
        os: run(['sw_vers', '-productVersion']).out,
        sip: run(['csrutil', 'status']).out,
        user: run(['id', '-un']).out,
        passwordlessSudo: canSudo,
        ...checks(),
      },
      null,
      2,
    ),
  )
  console.log('\nAncestry, nearest first:')
  for (const a of ancestry()) console.log(`  ${a.pid} ${[a.path, ...a.scripts].join(' ')}`)
  console.log(`\nSystem database grants:\n${grants(SYSTEM_DB)}`)
  console.log(`\nUser database grants:\n${grants(userDatabase())}`)
  console.log(`\ntccd's decisions in the log:\n${attribution().join('\n')}`)
}

/**
 * Writes Accessibility and Full Disk Access for every client to the system
 * database, and Automation of System Events and the app to the user's.
 * Returns whether every write went through.
 */
function writeGrants(appBundleId: string): boolean {
  const clients = new Set<string>()
  for (const a of ancestry()) {
    if (a.path.startsWith('/')) clients.add(a.path)
    for (const script of a.scripts) clients.add(script)
  }
  clients.add(process.execPath)
  clients.add('/usr/bin/osascript')

  const userDb = userDatabase()
  if (!userDb) console.log('No user TCC database found, so Automation was not granted')
  let ok = userDb !== null
  for (const client of clients) {
    const req = csreq(client)
    const row = (service: string, target: string, targetType: string) =>
      `INSERT OR REPLACE INTO access (service, client, client_type, auth_value, auth_reason, auth_version, csreq, flags, indirect_object_identifier_type, indirect_object_identifier) VALUES (${quote(service)}, ${quote(client)}, 1, 2, 4, 1, ${req}, 0, ${targetType}, ${quote(target)});`
    const system = sqlite(
      SYSTEM_DB,
      ['kTCCServiceAccessibility', 'kTCCServiceSystemPolicyAllFiles']
        .map((service) => row(service, 'UNUSED', 'NULL'))
        .join(' '),
    )
    if (system.code !== 0) {
      ok = false
      console.log(`The system TCC database refused ${client}: ${system.err}`)
    }
    if (!userDb) continue
    const user = sqlite(
      userDb,
      ['com.apple.systemevents', appBundleId]
        .map((target) => row('kTCCServiceAppleEvents', target, '0'))
        .join(' '),
    )
    if (user.code !== 0) {
      ok = false
      console.log(`The user TCC database refused ${client}: ${user.err}`)
    }
  }
  console.log(`Granted to ${[...clients].join(', ')}`)
  return ok
}

/**
 * Grants what sim needs, then checks it took. The checks cover Accessibility,
 * Automation of System Events and Full Disk Access, not Automation of the app
 * itself, so the rows are written even when they already pass.
 */
async function grant(appBundleId: string): Promise<boolean> {
  console.log(`Before: ${JSON.stringify(checks())}`)
  const wrote = writeGrants(appBundleId)
  let after = checks()
  // tccd caches decisions, and a fresh row may not count until it rereads.
  if (wrote && !passed(after)) {
    run(asRoot(['killall', 'tccd']))
    run(['killall', 'tccd'])
    await Bun.sleep(3000)
    after = checks()
  }
  console.log(`After: ${JSON.stringify(after)}`)
  // `passed` cannot see Automation of the app, so a grant that could not be
  // written fails here rather than as an unanswered prompt mid-suite.
  return wrote && passed(after)
}

/**
 * Switches an extension on under File Providers in System Settings. A new
 * extension starts with it off, and fileproviderd then fails every request
 * with "Sync is not enabled". The switch is the `Enabled` flag of the default
 * domain in fileproviderd's per-user Domains.plist. A domain the app
 * registers later copies it, but one registered already, as the launch after
 * install registers one, keeps its own flag, so every entry is set.
 * fileproviderd keeps the file in memory and writes it back, so it is killed
 * without a chance to save, and launchd starts it again on the next request,
 * reading the new file.
 */
function enableFileProvider(extBundleId: string): boolean {
  const plist = join(
    process.env.HOME ?? '',
    'Library/Application Support/FileProvider',
    extBundleId,
    'Domains.plist',
  )
  // fileproviderd writes the file some seconds after the install registers
  // the extension, and this step can run before it has.
  for (let waited = 0; !existsSync(plist) && waited < 60; waited++) Bun.sleepSync(1000)
  if (!existsSync(plist)) {
    console.log(
      `${plist} does not exist after a minute, so macOS has not registered ${extBundleId}`,
    )
    return false
  }
  const set = run([
    'plutil',
    '-replace',
    'NSFileProviderDomainDefaultIdentifier',
    '-json',
    '{"Enabled":true,"Connected":false}',
    plist,
  ])
  if (set.code !== 0) {
    console.log(`Could not write ${plist}: ${set.err}`)
    return false
  }
  // `plutil -p` prints each top-level key at two spaces of indent. A key path
  // cannot name a key containing a dot, and domain ids here have none.
  const domains = [...run(['plutil', '-p', plist]).out.matchAll(/^ {2}"([^"]+)" => \{$/gm)].map(
    (m) => m[1]!,
  )
  for (const domain of domains) {
    if (domain.includes('.')) continue
    const r = run(['plutil', '-replace', `${domain}.Enabled`, '-bool', 'YES', plist])
    if (r.code !== 0) console.log(`Could not switch on ${domain}: ${r.err}`)
  }
  run(['killall', '-9', 'fileproviderd'])
  Bun.sleepSync(3000)
  const dump = run(['fileproviderctl', 'dump', extBundleId], { timeoutMs: 60_000 })
  // A dump that failed or timed out has no "user-disabled" in its empty output either.
  if (dump.code !== 0) {
    console.log(`fileproviderctl dump failed with ${dump.code}: ${dump.err}`)
    return false
  }
  const disabled = dump.out.includes('user-disabled')
  console.log(`${extBundleId}: ${disabled ? 'still switched off' : 'switched on'}`)
  return !disabled
}

function option(args: string[], name: string): string {
  const value = args[args.indexOf(name) + 1]
  if (!args.includes(name) || !value) throw new Error(`${name} needs a bundle id`)
  return value
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'grant') {
  if (!(await grant(option(rest, '--app')))) {
    report()
    process.exit(1)
  }
} else if (command === 'enable-file-provider') {
  if (!enableFileProvider(option(rest, '--ext'))) process.exit(1)
} else if (command === 'report') {
  report()
} else {
  console.error(
    'usage: macos-ci-setup.ts grant --app <bundle id> | enable-file-provider --ext <bundle id> | report',
  )
  process.exit(2)
}
