import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export function getDataDir(): string {
  return process.env.SIA_DATA_DIR || path.join(os.homedir(), '.siastorage')
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
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true })
}
