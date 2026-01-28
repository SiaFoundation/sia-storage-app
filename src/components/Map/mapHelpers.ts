import { Dimensions } from 'react-native'
import type { Region } from 'react-native-maps'
import type { Host } from 'react-native-sia'

type Pt = { latitude: number; longitude: number }

const isValid = (p?: Partial<Pt>): p is Pt =>
  !!p &&
  typeof p.latitude === 'number' &&
  typeof p.longitude === 'number' &&
  p.latitude >= -90 &&
  p.latitude <= 90 &&
  p.longitude >= -180 &&
  p.longitude <= 180

function minimalLonSpan(longitudes: number[]) {
  const norm = longitudes.map((lon) => (lon + 360) % 360).sort((a, b) => a - b)
  if (norm.length === 1)
    return { center: ((norm[0] + 540) % 360) - 180, span: 0 }

  let maxGap = -1,
    idx = 0
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i]
    const b = i === norm.length - 1 ? norm[0] + 360 : norm[i + 1]
    const gap = b - a
    if (gap > maxGap) {
      maxGap = gap
      idx = i
    }
  }
  const start = norm[(idx + 1) % norm.length] % 360
  const end = norm[idx]
  const span = (end - start + 360) % 360
  let center = (start + span / 2) % 360
  if (center > 180) center -= 360
  return { center, span }
}

export function determineBestRegion(
  points: Partial<Host>[],
  opts?: {
    minDeltaDeg?: number
    paddingFactor?: number
  },
): Region | undefined {
  const valid = points.filter(isValid)
  if (valid.length === 0) return undefined

  const { width, height } = Dimensions.get('window')
  const aspect = width / height

  let minLat = Infinity,
    maxLat = -Infinity
  const lons: number[] = []

  for (const p of valid) {
    minLat = Math.min(minLat, p.latitude)
    maxLat = Math.max(maxLat, p.latitude)
    lons.push(p.longitude)
  }

  const latCenter = (minLat + maxLat) / 2
  const { center: lonCenter, span: lonSpan } = minimalLonSpan(lons)

  const padding = opts?.paddingFactor ?? 1.15
  let latDelta = (maxLat - minLat) * padding
  let lonDelta = lonSpan * padding

  const minDelta = opts?.minDeltaDeg ?? 0.5
  if (latDelta < minDelta) latDelta = minDelta

  const cosLat = Math.max(0.2, Math.cos((latCenter * Math.PI) / 180))
  const lonNeededForAspect = (latDelta * aspect) / cosLat
  if (lonDelta < lonNeededForAspect) lonDelta = lonNeededForAspect

  latDelta = Math.min(170, Math.max(minDelta, latDelta))
  lonDelta = Math.min(360, Math.max(minDelta, lonDelta))

  return {
    latitude: latCenter,
    longitude: lonCenter,
    latitudeDelta: latDelta,
    longitudeDelta: lonDelta,
  }
}
