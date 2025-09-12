export function humanSize(fileSize: number | null) {
  if (fileSize == null) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let s = fileSize
  let u = 0
  while (s >= 1024 && u < units.length - 1) {
    s /= 1024
    u += 1
  }
  return `${s.toFixed(1)} ${units[u]}`
}
