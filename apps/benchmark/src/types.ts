export type DatasetConfig = {
  scale: number // multiplier: 1 = ~1M records, 10 = ~10M
}

export type DatasetInfo = {
  totalRecords: number
  currentFiles: number
  directories: number
  tags: number
  objectsPopulated: number
  fsPopulated: number
  generationTimeMs: number
}

export type QuerySpec = {
  name: string
  category: string
  run: () => Promise<unknown>
}

export type BenchmarkResult = {
  query: string
  category: string
  iterations: number
  avgMs: number
  minMs: number
  maxMs: number
  medianMs: number
  p95Ms: number
  resultPreview: string
}

export type BenchmarkReport = {
  approach: string
  timestamp: string
  dataset: DatasetInfo
  environment: {
    platform: string
    runtime: string
  }
  results: BenchmarkResult[]
}
