/**
 * Compact list-row timestamp, coarser with age: "Just now", "5m ago", "3h ago",
 * "Yesterday", "Jul 2" (this year), "Jul 2, 2025". No bare-weekday tier: with
 * no daily-list habit behind it, "Fri" reads as a mistake, not last Friday.
 */
export function relativeTimeLabel(ts: number, now: number): string {
  const ms = now - ts
  if (ms < 60_000) return 'Just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 2 * 86_400_000) return 'Yesterday'
  const date = new Date(ts)
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Mid-sentence form ("added just now"): the sentence-case labels lowercase;
 * weekday and date forms stay as-is. */
export function relativeTimePhrase(ts: number, now: number): string {
  const label = relativeTimeLabel(ts, now)
  return label === 'Just now' || label === 'Yesterday' ? label.toLowerCase() : label
}
