import { memo } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'

export type Pt = { x: number; y: number }
export type GlyphShape = Pt[]

export const BLOCK_COLORS = [
  '#C3E500',
  '#76E6EB',
  '#36D955',
  '#E50AAE',
  '#FF7919',
] as const

export type ShapeId =
  | 'block1'
  | 'line2'
  | 'line3'
  | 'corner3'
  | 'j4'
  | 'square4'
  | 't4'

export const SHAPES: Record<ShapeId, GlyphShape> = {
  block1: [{ x: 0, y: 0 }],
  line2: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  line3: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
  ],
  corner3: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  j4: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: -1, y: 2 },
  ],
  square4: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  t4: [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 2 },
  ],
}

export const rotate90 = (s: GlyphShape): GlyphShape =>
  s.map(({ x, y }) => ({ x: -y, y: x }))
const rotateTimes = (s: GlyphShape, deg: 0 | 90 | 180 | 270): GlyphShape => {
  const times = deg === 0 ? 0 : deg === 90 ? 1 : deg === 180 ? 2 : 3
  let out = s
  for (let i = 0; i < times; i++) out = rotate90(out)
  return out
}
export const mirrorX = (s: GlyphShape): GlyphShape => {
  const maxX = Math.max(...s.map((p) => p.x))
  return s.map(({ x, y }) => ({ x: maxX - x, y }))
}
export const normalize = (s: GlyphShape): GlyphShape => {
  const minX = Math.min(...s.map((p) => p.x))
  const minY = Math.min(...s.map((p) => p.y))
  return s.map(({ x, y }) => ({ x: x - minX, y: y - minY }))
}

export function getTransformedShapePoints(
  shape: ShapeId,
  options: { rotation?: 0 | 90 | 180 | 270; mirror?: boolean } = {},
): GlyphShape {
  const { rotation = 0, mirror = false } = options
  const base = SHAPES[shape]
  const transformed = normalize(
    rotateTimes(mirror ? mirrorX(base) : base, rotation),
  )
  return transformed
}

export type BlocksShapeProps = {
  shape: ShapeId
  origin: { x: number; y: number }
  tileSize: number
  rotation?: 0 | 90 | 180 | 270
  mirror?: boolean
  palette?: readonly string[]
  ringStart?: number
  style?: ViewStyle
  tileStyle?: ViewStyle
}

function BlocksShapeBase({
  shape,
  origin,
  tileSize,
  rotation = 0,
  mirror = false,
  palette = BLOCK_COLORS,
  ringStart = 0,
  style,
  tileStyle,
}: BlocksShapeProps) {
  const transformed = getTransformedShapePoints(shape, { rotation, mirror })
  return (
    <View style={[styles.glyph, style]} pointerEvents="none">
      {transformed.map((p, i) => {
        const color = palette[(ringStart + i) % palette.length]
        const left = origin.x + p.x * tileSize
        const top = origin.y + p.y * tileSize
        return (
          <View
            key={`t${i}`}
            style={[
              styles.tile,
              {
                left,
                top,
                width: tileSize,
                height: tileSize,
                backgroundColor: color,
              },
              tileStyle,
            ]}
          />
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  glyph: { position: 'absolute' },
  tile: { position: 'absolute', borderRadius: 0 },
})

// This should tamp down on unnecessary re-renders for what could be
// lots of these on a screen.
export default memo(BlocksShapeBase)
