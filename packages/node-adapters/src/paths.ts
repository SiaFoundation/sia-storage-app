import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export function getDataDir(): string {
  return process.env.SIA_DATA_DIR || path.join(os.homedir(), '.sia')
}

export function getPaths(dataDir: string) {
  return {
    dataDir,
    dbPath: path.join(dataDir, 'data.db'),
    configPath: path.join(dataDir, 'config.json'),
    storagePath: path.join(dataDir, 'storage.json'),
    secretsPath: path.join(dataDir, 'secrets.json'),
    statePath: path.join(dataDir, 'state.json'),
    filesDir: path.join(dataDir, 'files'),
    pidPath: path.join(dataDir, 'daemon.pid'),
    lockPath: path.join(dataDir, 'daemon.lock'),
    sockPath: path.join(dataDir, 'daemon.sock'),
    logPath: path.join(dataDir, 'daemon.log'),
  }
}

export function ensureDataDir(dataDir: string): void {
  // 0700 — the data dir holds secrets.json, the IPC socket, and the SQLite
  // database. Anything other than the owning user must be denied access.
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true, mode: 0o700 })
  // mkdirSync's mode is only honored on creation, so chmod existing dirs too.
  try {
    fs.chmodSync(dataDir, 0o700)
    fs.chmodSync(path.join(dataDir, 'files'), 0o700)
  } catch {
    // best effort — Windows doesn't honor POSIX modes
  }
}
