export function daysInMs(days: number): number {
  return days * 24 * 60 * 60 * 1_000
}

export function minutesInMs(minutes: number): number {
  return minutes * 60 * 1_000
}

export function secondsInMs(seconds: number): number {
  return seconds * 1_000
}
