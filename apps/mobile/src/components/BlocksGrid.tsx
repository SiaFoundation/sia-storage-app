import { useEffect, useMemo, useState } from 'react'
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import BlocksShape, {
  BLOCK_COLORS,
  type GlyphShape,
  getTransformedShapePoints,
  type ShapeId,
} from './BlocksShape'

type AnimationMode = 'none' | 'typeFade' | 'swap'

export type BlocksGridProps = {
  rows: number
  cols: number
  tileScale?: number
  animation?: AnimationMode
  colors?: string[]
  inset?: { horizontal?: number; top?: number; bottom?: number }
  style?: ViewStyle
  opacity?: number
}

const typeFadeDurationMS = 500
const typeFadeStaggerMS = 250
const swapIntervalMS = 900

const ORDER_BASE: readonly ShapeId[] = ['j4', 'square4', 'line3', 'corner3', 't4', 'line2'] as const

const getCentroid = (points: GlyphShape) => {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length
  return { cx, cy }
}

type CellConfig = {
  shape: ShapeId
  rotation: 0 | 90 | 180 | 270
  mirror: boolean
  ringStart: number
}

const rotationOptions: readonly (0 | 90 | 180 | 270)[] = [0, 90, 180, 270] as const

const makeRandomCell = (colorsCount: number): CellConfig => {
  const shape = ORDER_BASE[Math.floor(Math.random() * ORDER_BASE.length)]
  const rotation = rotationOptions[Math.floor(Math.random() * rotationOptions.length)]
  const mirror = Math.random() > 0.5
  const ringStart = colorsCount > 0 ? Math.floor(Math.random() * colorsCount) : 0

  return { shape, rotation, mirror, ringStart }
}

export default function BlocksGrid({
  rows,
  cols,
  tileScale = 0.15,
  animation = 'none',
  colors = BLOCK_COLORS as unknown as string[],
  inset = { horizontal: 8, top: 6, bottom: 6 },
  style,
  opacity = 1,
}: BlocksGridProps) {
  const [bounds, setBounds] = useState({ w: 0, h: 0 })
  const [gridMap, setGridMap] = useState<CellConfig[][]>([])
  const gridColCount = gridMap[0]?.length ?? 0

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    if (width !== bounds.w || height !== bounds.h) {
      setBounds({ w: width, h: height })
    }
  }

  useEffect(() => {
    const makeGrid = () => {
      const g: typeof gridMap = []
      for (let r = 0; r < rows; r++) {
        const row: (typeof gridMap)[number] = []
        for (let c = 0; c < cols; c++) {
          row.push(makeRandomCell(colors.length))
        }
        g.push(row)
      }
      setGridMap(g)
    }
    makeGrid()
  }, [rows, cols, colors.length])

  const typeDrivers = useMemo(() => {
    const d: Record<ShapeId, Animated.Value> = Object.fromEntries(
      ORDER_BASE.map((s) => [s, new Animated.Value(animation === 'typeFade' ? 0 : 1)]),
    ) as Record<ShapeId, Animated.Value>
    return d
  }, [animation])

  useEffect(() => {
    if (animation !== 'typeFade') return
    ORDER_BASE.forEach((shapeId, i) => {
      Animated.timing(typeDrivers[shapeId], {
        toValue: 1,
        duration: typeFadeDurationMS,
        delay: i * typeFadeStaggerMS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start()
    })
  }, [animation, typeDrivers])

  useEffect(() => {
    if (animation !== 'swap') {
      return
    }
    if (!gridMap.length || !gridColCount) {
      return
    }

    const interval = setInterval(() => {
      setGridMap((prev) => {
        if (!prev.length || !prev[0]?.length) {
          return prev
        }
        const rowIndex = Math.floor(Math.random() * prev.length)
        const colCount = prev[rowIndex]?.length ?? 0
        if (colCount === 0) return prev
        const colIndex = Math.floor(Math.random() * colCount)

        return prev.map((row, r) => {
          if (r !== rowIndex) {
            return row
          }
          return row.map((cell, c) => {
            if (c !== colIndex) {
              return cell
            }
            return makeRandomCell(colors.length)
          })
        })
      })
    }, swapIntervalMS)

    return () => {
      clearInterval(interval)
    }
  }, [animation, colors.length, gridMap.length, gridColCount])

  if (bounds.w <= 0 || bounds.h <= 0 || gridMap.length === 0) {
    return (
      <View
        onLayout={onLayout}
        style={[styles.container, { opacity }, style]}
        pointerEvents="none"
      />
    )
  }

  const insetH = inset.horizontal ?? 0
  const insetTop = inset.top ?? 0
  const insetBottom = inset.bottom ?? 0

  const drawLeft = insetH
  const drawTop = insetTop
  const drawWidth = Math.max(1, bounds.w - insetH * 2)
  const drawHeight = Math.max(1, bounds.h - insetTop - insetBottom)

  const cellW = drawWidth / Math.max(1, cols)
  const cellH = drawHeight / Math.max(1, rows)
  const baseTile = Math.floor(cellW * tileScale)
  const padX = Math.floor(cellW * 0.12)
  const padY = Math.floor(cellH * 0.12)

  return (
    <View onLayout={onLayout} style={[styles.container, { opacity }, style]} pointerEvents="none">
      {gridMap.map((row, r) =>
        row.map((cell, c) => {
          const { shape, rotation, mirror, ringStart } = cell
          const transformedPts = getTransformedShapePoints(shape, {
            rotation,
            mirror,
          })
          const usableW = cellW - padX * 2
          const usableH = cellH - padY * 2
          const maxX = Math.max(...transformedPts.map((p) => p.x))
          const maxY = Math.max(...transformedPts.map((p) => p.y))
          const unitsW = maxX + 1
          const unitsH = maxY + 1
          const localTile = Math.min(
            Math.floor(baseTile),
            Math.floor(usableW / unitsW),
            Math.floor(usableH / unitsH),
          )
          const tileSize = Math.max(1, localTile)

          const { cx, cy } = getCentroid(transformedPts)
          const cellCenterX = drawLeft + c * cellW + cellW / 2
          const cellCenterY = drawTop + r * cellH + cellH / 2
          const originX = cellCenterX - (cx + 0.5) * tileSize
          const originY = cellCenterY - (cy + 0.5) * tileSize

          const opacityDriver = animation === 'typeFade' ? typeDrivers[shape] : 1

          return (
            <Animated.View
              key={`${r}-${c}`}
              style={[styles.glyph, { opacity: opacityDriver as any }]}
              pointerEvents="none"
            >
              <BlocksShape
                shape={shape}
                rotation={rotation}
                mirror={mirror}
                origin={{ x: originX, y: originY }}
                tileSize={tileSize}
                palette={colors}
                ringStart={ringStart}
              />
            </Animated.View>
          )
        }),
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  glyph: { position: 'absolute' },
})
