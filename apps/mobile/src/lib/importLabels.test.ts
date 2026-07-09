import type { ImportSummary } from '@siastorage/core/db/operations'
import { palette } from '../styles/colors'
import {
  countChips,
  detailStatusLabel,
  fileStateStyle,
  progressBytesLabel,
  progressCountLabel,
  progressRatio,
  sourceLabel,
  statusColor,
  statusLabel,
  summaryLine,
  fileRowStyle,
  isRetryingRow,
  reasonCopy,
  retryCountdownLabel,
} from './importLabels'

function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    importId: 'imp-1',
    status: 'importing',
    added: 0,
    duplicate: 0,
    unavailable: 0,
    failed: 0,
    cancelled: 0,
    inFlight: 0,
    total: 0,
    sizedCount: 0,
    copiedBytes: 0,
    totalBytes: 0,
    ...overrides,
  }
}

describe('sourceLabel / statusLabel', () => {
  it('maps known sources to friendly labels', () => {
    expect(sourceLabel('picker')).toBe('Files')
    expect(sourceLabel('library-scan')).toBe('Photo library')
    expect(sourceLabel('new-photos')).toBe('New photos')
    expect(sourceLabel('legacy')).toBe('Imported before update')
  })

  it('maps statuses to labels', () => {
    expect(statusLabel('queued')).toBe('Queued')
    expect(statusLabel('importing')).toBe('Importing')
    expect(statusLabel('done')).toBe('Done')
  })
})

describe('statusColor', () => {
  it('is blue while in-flight regardless of failures', () => {
    expect(statusColor(summary({ status: 'importing', failed: 3 }))).toBe(palette.blue[400])
    expect(statusColor(summary({ status: 'queued' }))).toBe(palette.blue[400])
  })

  it('is green when done and clean', () => {
    expect(statusColor(summary({ status: 'done', added: 5 }))).toBe(palette.green[500])
  })

  it('is amber when done with failed or unavailable children', () => {
    expect(statusColor(summary({ status: 'done', added: 4, failed: 1 }))).toBe(palette.yellow[400])
    expect(statusColor(summary({ status: 'done', added: 4, unavailable: 1 }))).toBe(
      palette.yellow[400],
    )
  })

  it('is gray when done and cancelled, even alongside failures', () => {
    expect(statusColor(summary({ status: 'done', cancelled: 1, failed: 2 }))).toBe(
      palette.gray[400],
    )
  })
})

describe('detailStatusLabel', () => {
  it('reports the plain status while the import is still in flight', () => {
    expect(detailStatusLabel(summary({ status: 'importing', cancelled: 3 }))).toBe('Importing')
    expect(detailStatusLabel(summary({ status: 'queued' }))).toBe('Queued')
  })

  it('reads Cancelled when done with a cancelled row, outranking failures', () => {
    expect(detailStatusLabel(summary({ status: 'done', cancelled: 1, failed: 2 }))).toBe(
      'Cancelled',
    )
  })

  it('reads Completed when done with failed or unavailable rows', () => {
    expect(detailStatusLabel(summary({ status: 'done', added: 4, failed: 1 }))).toBe('Completed')
    expect(detailStatusLabel(summary({ status: 'done', added: 4, unavailable: 1 }))).toBe(
      'Completed',
    )
  })

  it('reads Complete only when done with nothing cancelled, failed, or unavailable', () => {
    expect(detailStatusLabel(summary({ status: 'done', added: 5 }))).toBe('Complete')
  })
})

describe('progressRatio', () => {
  it('uses the cumulative byte bar, clamped, when every size is known', () => {
    const imp = { expectedCount: 10 }
    expect(
      progressRatio(imp, summary({ total: 10, sizedCount: 10, copiedBytes: 50, totalBytes: 100 })),
    ).toBeCloseTo(0.5)
    // Over-measured bytes clamp to 1.
    expect(
      progressRatio(imp, summary({ total: 10, sizedCount: 10, copiedBytes: 150, totalBytes: 100 })),
    ).toBe(1)
  })

  it('falls back to the count bar when any size is unknown, so a partial byte total never lies', () => {
    const imp = { expectedCount: 10 }
    expect(
      progressRatio(
        imp,
        summary({ total: 10, inFlight: 6, sizedCount: 9, copiedBytes: 50, totalBytes: 100 }),
      ),
    ).toBeCloseTo(0.4)
  })

  it('counts finished rows over the expected total for the count bar', () => {
    const imp = { expectedCount: 10 }
    // 4 of 10 finished (6 still in flight).
    expect(progressRatio(imp, summary({ total: 10, inFlight: 6 }))).toBeCloseTo(0.4)
    // All rows terminal reads as 1.
    expect(progressRatio(imp, summary({ total: 10, inFlight: 0 }))).toBe(1)
  })

  it('count denominator floors at the observed total so it never exceeds 1', () => {
    // When expectedCount lags behind the observed total, the total is the denominator.
    const imp = { expectedCount: 0 }
    expect(progressRatio(imp, summary({ total: 5, inFlight: 0 }))).toBe(1)
  })

  it('progressCountLabel formats processed of expected', () => {
    expect(
      progressCountLabel({ expectedCount: 1000 }, summary({ total: 1000, inFlight: 254 })),
    ).toBe('746 of 1,000')
  })

  it('progressBytesLabel renders only when every size is known', () => {
    expect(
      progressBytesLabel(
        summary({ total: 2, sizedCount: 2, copiedBytes: 500_000, totalBytes: 2_000_000 }),
      ),
    ).toBe('500.0 KB of 2.0 MB')
    // One unknown size hides the byte line (a partial total would read as authoritative).
    expect(
      progressBytesLabel(
        summary({ total: 2, sizedCount: 1, copiedBytes: 500_000, totalBytes: 1_000_000 }),
      ),
    ).toBeNull()
    // copied clamps to the total.
    expect(
      progressBytesLabel(summary({ total: 1, sizedCount: 1, copiedBytes: 300, totalBytes: 200 })),
    ).toBe('200.0 B of 200.0 B')
  })

  it('summaryLine composes non-zero outcomes and pluralizes', () => {
    expect(summaryLine(summary({ added: 1000 }))).toBe('1,000 added')
    expect(summaryLine(summary({ added: 7, duplicate: 5 }))).toBe('7 added · 5 duplicates')
    expect(summaryLine(summary({ duplicate: 1, failed: 2 }))).toBe('1 duplicate · 2 failed')
    expect(summaryLine(summary({}))).toBe('No files')
  })
})

describe('countChips', () => {
  it('drops zero-count states and keeps the rest in order', () => {
    const chips = countChips(summary({ added: 3, duplicate: 0, unavailable: 2, failed: 0 }))
    expect(chips.map((c) => c.label)).toEqual(['Added', 'Unavailable'])
    expect(chips[0].count).toBe(3)
    expect(chips[1].count).toBe(2)
  })

  it('returns empty when all counts are zero', () => {
    expect(countChips(summary())).toEqual([])
  })
})

describe('fileStateStyle', () => {
  it('marks in-flight states with a spinner', () => {
    expect(fileStateStyle('pending').spinner).toBe(true)
    expect(fileStateStyle('active').spinner).toBe(true)
  })
})

const NOW = 1_700_000_000_000

function row(over: {
  state?: 'pending' | 'active' | 'added' | 'failed' | 'unavailable'
  attempts?: number
  nextAttemptAt?: number
  reason?: string | null
}) {
  return {
    state: over.state ?? 'pending',
    attempts: over.attempts ?? 0,
    nextAttemptAt: over.nextAttemptAt ?? 0,
    reason: over.reason ?? null,
  } as const
}

describe('reasonCopy', () => {
  it('maps registry codes to user copy', () => {
    expect(reasonCopy('not-enough-space')).toBe('Not enough space on this device')
    expect(reasonCopy('cloud-pending')).toBe('Waiting for iCloud download')
  })

  it('renders pre-registry sentence reasons as-is (legacy rows)', () => {
    expect(reasonCopy('processing error')).toBe('processing error')
  })

  it('is null for no reason', () => {
    expect(reasonCopy(null)).toBeNull()
  })
})

describe('fileRowStyle', () => {
  it('a pending row in backoff shows Retrying with the cap of its reason, no spinner', () => {
    const style = fileRowStyle(
      row({ attempts: 2, nextAttemptAt: NOW + 60_000, reason: 'cloud-pending' }),
      NOW,
    )
    expect(style.label).toBe('Retrying (2/8)')
    expect(style.spinner).toBe(false)
  })

  it('a deterministic reason caps the denominator (export-failed caps at 2)', () => {
    const style = fileRowStyle(
      row({ attempts: 1, nextAttemptAt: NOW + 60_000, reason: 'export-failed' }),
      NOW,
    )
    expect(style.label).toBe('Retrying (1/2)')
  })

  it('a fresh pending row keeps the Pending spinner', () => {
    const style = fileRowStyle(row({ attempts: 0 }), NOW)
    expect(style.label).toBe('Pending')
    expect(style.spinner).toBe(true)
  })

  it('a backoff row whose timer already elapsed renders Pending (about to be claimed)', () => {
    const style = fileRowStyle(
      row({ attempts: 3, nextAttemptAt: NOW - 1, reason: 'io-error' }),
      NOW,
    )
    expect(style.label).toBe('Pending')
  })
})

describe('retryCountdownLabel', () => {
  it('floors at <1m and rounds minutes', () => {
    expect(retryCountdownLabel(NOW + 30_000, NOW)).toBe('in <1m')
    expect(retryCountdownLabel(NOW + 59_999, NOW)).toBe('in <1m')
    expect(retryCountdownLabel(NOW + 60_000, NOW)).toBe('in 1m')
    expect(retryCountdownLabel(NOW + 5 * 60_000, NOW)).toBe('in 5m')
  })
})

describe('isRetryingRow', () => {
  it('requires pending, attempts, and a future timer', () => {
    expect(isRetryingRow(row({ attempts: 1, nextAttemptAt: NOW + 1 }), NOW)).toBe(true)
    expect(isRetryingRow(row({ attempts: 0, nextAttemptAt: NOW + 1 }), NOW)).toBe(false)
    expect(isRetryingRow(row({ state: 'active', attempts: 1, nextAttemptAt: NOW + 1 }), NOW)).toBe(
      false,
    )
  })
})
