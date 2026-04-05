import * as fs from 'fs'
import * as path from 'path'
import type { BenchmarkReport } from './types'

export function writeReport(report: BenchmarkReport, outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true })

  const jsonPath = path.join(outputDir, `benchmark-${report.approach}.json`)
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  console.log(`\nJSON results: ${jsonPath}`)

  const mdPath = path.join(outputDir, `benchmark-${report.approach}.md`)
  fs.writeFileSync(mdPath, formatMarkdown(report))
  console.log(`Markdown results: ${mdPath}`)
}

function formatMarkdown(report: BenchmarkReport): string {
  const lines: string[] = []

  lines.push(`# Benchmark: ${report.approach}`)
  lines.push('')
  lines.push(`**Date:** ${report.timestamp}`)
  lines.push(`**Platform:** ${report.environment.platform}`)
  lines.push(`**Runtime:** ${report.environment.runtime}`)
  lines.push('')
  lines.push('## Dataset')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Total records | ${report.dataset.totalRecords.toLocaleString()} |`)
  lines.push(`| Current files | ${report.dataset.currentFiles.toLocaleString()} |`)
  lines.push(`| Directories | ${report.dataset.directories} |`)
  lines.push(`| Tags | ${report.dataset.tags} |`)
  lines.push(`| Objects populated | ${report.dataset.objectsPopulated.toLocaleString()} |`)
  lines.push(`| fs populated | ${report.dataset.fsPopulated.toLocaleString()} |`)
  lines.push(`| Generation time | ${(report.dataset.generationTimeMs / 1000).toFixed(1)}s |`)
  lines.push('')
  lines.push('## Results')
  lines.push('')

  const categories = [...new Set(report.results.map((r) => r.category))]

  for (const category of categories) {
    lines.push(`### ${category}`)
    lines.push('')
    lines.push('| Query | Avg (ms) | Min (ms) | Max (ms) | Median (ms) | P95 (ms) | Result |')
    lines.push('|---|---|---|---|---|---|---|')

    const categoryResults = report.results.filter((r) => r.category === category)
    for (const r of categoryResults) {
      lines.push(
        `| ${r.query} | ${r.avgMs} | ${r.minMs} | ${r.maxMs} | ${r.medianMs} | ${r.p95Ms} | ${r.resultPreview} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function writeComparison(
  reportA: BenchmarkReport,
  reportB: BenchmarkReport,
  outputDir: string,
): void {
  const lines: string[] = []

  lines.push('# Benchmark Comparison')
  lines.push('')
  lines.push(`| | ${reportA.approach} | ${reportB.approach} |`)
  lines.push(`|---|---|---|`)
  lines.push(
    `| Total records | ${reportA.dataset.totalRecords.toLocaleString()} | ${reportB.dataset.totalRecords.toLocaleString()} |`,
  )
  lines.push('')
  lines.push('| Query | A Avg (ms) | B Avg (ms) | Change | Speedup |')
  lines.push('|---|---|---|---|---|')

  for (const a of reportA.results) {
    const b = reportB.results.find((r) => r.query === a.query)
    if (!b) continue
    const change = b.avgMs - a.avgMs
    const speedup = a.avgMs > 0 ? `${(a.avgMs / b.avgMs).toFixed(1)}x` : '-'
    const sign = change > 0 ? '+' : ''
    lines.push(
      `| ${a.query} | ${a.avgMs} | ${b.avgMs} | ${sign}${change.toFixed(1)}ms | ${speedup} |`,
    )
  }

  const mdPath = path.join(outputDir, 'comparison.md')
  fs.writeFileSync(mdPath, lines.join('\n'))
  console.log(`Comparison: ${mdPath}`)
}
