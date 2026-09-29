/**
 * What an agent reads off a running device besides its library: its log lines
 * filtered to what matters, how hard the app is working, how long its calls
 * take, and what its database holds. Every device writes log lines in one
 * format, `<date> <time> <LEVEL> [<scope>] <message> <data>`, so one filter
 * serves the daemon's log file and a phone's log table alike.
 */
import type { Device } from './devices'

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type Level = (typeof LEVELS)[number]

export type LogFilter = { scope?: string; level?: Level; grep?: string }

const LINE = /^\S+ \S+ (\w+)\s+\[([^\]]+)\]/

/** The lines of `text` that pass `filter`. A line without the level and scope prefix passes. */
export function filterLogs(text: string, filter: LogFilter): string[] {
  const min = filter.level ? LEVELS.indexOf(filter.level) : 0
  const needle = filter.grep?.toLowerCase()
  return text.split('\n').filter((line) => {
    if (!line) return false
    const m = LINE.exec(line)
    if (m) {
      const level = LEVELS.indexOf(m[1].toLowerCase() as Level)
      if (level >= 0 && level < min) return false
      if (filter.scope && m[2] !== filter.scope) return false
    } else if (filter.level || filter.scope) {
      return false
    }
    return !needle || line.toLowerCase().includes(needle)
  })
}

export function isLevel(text: string): text is Level {
  return (LEVELS as readonly string[]).includes(text)
}

export type Summary = {
  n: number
  min: number
  p50: number
  p95: number
  max: number
  mean: number
}

/** Nearest-rank percentiles, so every reported value is one that was measured. */
export function summarize(values: number[]): Summary {
  if (values.length === 0) return { n: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
  const round = (v: number) => Math.round(v * 10) / 10
  return {
    n: sorted.length,
    min: round(sorted[0]),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  }
}

/**
 * Times `runs` calls of an AppService method on `device`, `concurrency` at a
 * time. The time includes sim's bridge to the app, which is the same on both
 * sides of a before-and-after comparison.
 */
export async function bench(
  device: Device,
  method: string,
  args: unknown[],
  opts: { runs: number; concurrency: number; warmup: number },
): Promise<Summary> {
  for (let i = 0; i < opts.warmup; i++) await device.call(method, ...args)
  const times: number[] = []
  let next = 0
  const worker = async () => {
    while (next < opts.runs) {
      next++
      const start = performance.now()
      await device.call(method, ...args)
      times.push(performance.now() - start)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker))
  return summarize(times)
}

/** A device's tables with their row counts, or one table's columns. */
export async function schema(device: Device, table?: string): Promise<unknown> {
  if (table) {
    return device.sql<{ name: string; type: string; notnull: number; pk: number }>(
      'SELECT name, type, "notnull", pk FROM pragma_table_info(?1)',
      table,
    )
  }
  const tables = await device.sql<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  const out: Array<{ table: string; rows: number }> = []
  for (const { name } of tables) {
    const [row] = await device.sql<{ n: number }>(`SELECT count(*) AS n FROM "${name}"`)
    out.push({ table: name, rows: row?.n ?? 0 })
  }
  return out
}

export type Perf = { samples: number; cpu: Summary; rssMb: Summary }

/**
 * How hard a device's app works over `samples` seconds, read once a second
 * from its process. On an iOS simulator the app's own performance monitor
 * logs its ticks with no numbers, so the process is read from outside instead.
 */
export async function perf(device: Device, samples: number): Promise<Perf> {
  if (!device.sampleProcess) throw new Error(`${device.name} cannot be sampled`)
  const cpu: number[] = []
  const rss: number[] = []
  for (let i = 0; i < samples; i++) {
    const s = await device.sampleProcess()
    if (!s) throw new Error(`${device.name}'s app is not running`)
    cpu.push(s.cpu)
    rss.push(s.rssMb)
    if (i < samples - 1) await Bun.sleep(1000)
  }
  return { samples: cpu.length, cpu: summarize(cpu), rssMb: summarize(rss) }
}
