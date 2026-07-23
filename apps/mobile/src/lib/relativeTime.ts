/**
 * Compact list-row timestamp, coarser with age: "Just now", "5m ago", "3h ago",
 * "Yesterday", "Tue" (within the last week), "Jul 2" (this year), "Jul 2, 2025".
 */
export function relativeTimeLabel(ts: number, now: number): string {
  const ms = now - ts
  if (ms < 60_000) return 'Just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 2 * 86_400_000) return 'Yesterday'
  const date = new Date(ts)
  if (ms < 7 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'short' })
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
