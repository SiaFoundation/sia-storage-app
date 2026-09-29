/**
 * Reports which SQLite locks an app holds on its database files, read from the
 * Mac with fcntl(F_GETLK). The simulator never kills an app for holding a lock
 * while suspended the way a phone does (termination code 0xdead10cc), so this
 * is how a test checks the cause instead: after the app has suspended, nothing
 * that makes a phone kill it may still be held.
 *
 * Offsets are the unix VFS's: on the database file, pending at 0x40000000,
 * reserved one byte after, and the 510-byte shared range after that. In WAL
 * mode the connection also locks bytes of the -shm file: the writer at 120,
 * the checkpointer at 121, recovery at 122, the five reader slots at 123-127,
 * and the dead-man switch at 128, which every open connection holds shared.
 */
import { $ } from 'bun'
import { existsSync } from 'node:fs'

export type HeldLock = { file: string; region: string; kind: 'read' | 'write'; pid: number }

const REGIONS: Record<string, Array<[string, number, number]>> = {
  db: [
    ['pending', 0x40000000, 1],
    ['reserved', 0x40000001, 1],
    ['shared', 0x40000002, 510],
  ],
  shm: [
    ['wal-writer', 120, 1],
    ['wal-checkpoint', 121, 1],
    ['wal-recover', 122, 1],
    ['wal-read-0', 123, 1],
    ['wal-read-1', 124, 1],
    ['wal-read-2', 125, 1],
    ['wal-read-3', 126, 1],
    ['wal-read-4', 127, 1],
    ['wal-dms', 128, 1],
  ],
}

// Python's fcntl module exposes F_GETLK with the platform's struct flock,
// which Bun cannot call directly.
const PROBE = `
import fcntl, json, os, struct, sys
fmt = 'qqihh'
out = []
for path, regions in json.loads(sys.argv[1]):
    fd = os.open(path, os.O_RDONLY)
    for name, start, length in regions:
        req = struct.pack(fmt, start, length, 0, fcntl.F_WRLCK, os.SEEK_SET)
        s, l, pid, typ, wh = struct.unpack(fmt, fcntl.fcntl(fd, fcntl.F_GETLK, req))
        if typ != fcntl.F_UNLCK:
            out.append({'file': path, 'region': name, 'kind': 'read' if typ == fcntl.F_RDLCK else 'write', 'pid': pid})
    os.close(fd)
print(json.dumps(out))
`

/**
 * The locks held on `dbPath` and its -shm file, one per region: F_GETLK reports
 * a single lock that conflicts with a write, so a region two processes hold
 * shows only one of them.
 */
export async function heldLocks(dbPath: string): Promise<HeldLock[]> {
  const targets: Array<[string, Array<[string, number, number]>]> = [[dbPath, REGIONS.db]]
  if (existsSync(`${dbPath}-shm`)) targets.push([`${dbPath}-shm`, REGIONS.shm])
  const out = await $`python3 -c ${PROBE} ${JSON.stringify(targets)}`.quiet().text()
  return JSON.parse(out) as HeldLock[]
}

/**
 * The locks a suspended app must not hold: any write lock, and any WAL reader
 * slot, which marks a read still in progress. The dead-man switch and a shared
 * lock on the database file are what an open, idle connection holds.
 */
export function suspendHazards(locks: HeldLock[]): HeldLock[] {
  return locks.filter((l) => l.kind === 'write' || l.region.startsWith('wal-read'))
}
