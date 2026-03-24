import type { BenchmarkResult, QuerySpec } from './types'

const WARMUP = 2
const ITERATIONS = 7

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.min(idx, sorted.length - 1)]
}

export async function runBenchmark(
  specs: QuerySpec[],
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []

  for (const spec of specs) {
    // Warmup
    for (let i = 0; i < WARMUP; i++) {
      await spec.run()
    }

    // Measured
    const timings: number[] = []
    let lastResult: unknown
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now()
      lastResult = await spec.run()
      timings.push(performance.now() - start)
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length
    const preview = formatPreview(lastResult)

    const result: BenchmarkResult = {
      query: spec.name,
      category: spec.category,
      iterations: ITERATIONS,
      avgMs: round(avg),
      minMs: round(Math.min(...timings)),
      maxMs: round(Math.max(...timings)),
      medianMs: round(median(timings)),
      p95Ms: round(p95(timings)),
      resultPreview: preview,
    }

    console.log(
      `  ${spec.name.padEnd(40)} avg=${result.avgMs.toFixed(1)}ms  min=${result.minMs.toFixed(1)}ms  max=${result.maxMs.toFixed(1)}ms  ${preview}`,
    )

    results.push(result)
  }

  return results
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function formatPreview(result: unknown): string {
  if (typeof result === 'number') return `count: ${result}`
  if (Array.isArray(result)) return `rows: ${result.length}`
  if (result && typeof result === 'object' && 'originals' in result) {
    const r = result as { originals: number; thumbs: number }
    return `originals: ${r.originals}, thumbs: ${r.thumbs}`
  }
  if (result && typeof result === 'object') {
    return `keys: ${Object.keys(result).length}`
  }
  return String(result)
}
