export function humanSize(fileSize: number | null) {
  if (fileSize == null) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let s = fileSize
  let u = 0
  while (s >= 1000 && u < units.length - 1) {
    s /= 1000
    u += 1
  }
  return `${s.toFixed(1)} ${units[u]}`
}

export function humanBitrate(bytesPerSec: number | null) {
  if (bytesPerSec == null) return null
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps']
  let s = bytesPerSec * 8
  let u = 0
  while (s >= 1000 && u < units.length - 1) {
    s /= 1000
    u += 1
  }
  return `${s.toFixed(1)} ${units[u]}`
}
