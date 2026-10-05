/*
 * One card of the pile, a photo or a document, that can be shown as it is or
 * as it leaves the Mac.
 *
 * Encrypting is drawn cell by cell on one fixed grid. Each cell first fades
 * from the picture to its own flat colour, then fades to the colour of the
 * cell that the shuffle puts in its place, which is what keeps the card's
 * colours and loses the picture. The cells start in a sweep across the photo
 * rather than together, and decrypting plays the same thing backwards.
 *
 * The grid never changes size. Coarsening the picture through ever larger
 * cells looks like pixelation, but every step redraws every cell boundary,
 * and that is what reads as flicker.
 */

import { useEffect, useRef } from 'react'
import { CARD, type Card, shuffledCells } from './cards'
import { seededRandom } from './shards'

const DURATION_MS = 420
/** Twice the drawn size, so the plain card is sharp on a Retina display. */
const SCALE = 2
const CELLS = CARD.cols * CARD.rows

/**
 * How the two fades are laid over the animation, as fractions of it. A cell
 * begins its fade somewhere inside `spread` and takes `length` to finish. The
 * second fade begins `from` of the way in, and its last cell finishes at 1.
 */
const TO_CELL = { spread: 0.4, length: 0.32 }
const TO_SHUFFLED = { from: 0.3, spread: 0.36, length: 0.34 }

type Layers = {
  /** The card at full size. */
  plain: HTMLCanvasElement
  /** Each cell's average colour, as r, g, b. */
  own: Uint8ClampedArray
  /** The colour each cell ends on: that of the cell shuffled into its place. */
  shuffled: Uint8ClampedArray
  /** When each cell starts its first fade, 0..1: a sweep from the top left, roughened. */
  sweep: Float32Array
  /** When each cell starts its second fade, 0..1, in no order at all. */
  scatter: Float32Array
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return element
}

async function buildLayers(card: Card): Promise<Layers | null> {
  const plain = canvas(CARD.width * SCALE, CARD.height * SCALE)
  const plainCtx = plain.getContext('2d')
  const averaged = canvas(CARD.cols, CARD.rows).getContext('2d', { willReadFrequently: true })
  if (!plainCtx || !averaged) return null

  if (card.kind === 'document') {
    plainCtx.scale(SCALE, SCALE)
    card.paint(plainCtx, CARD.width, CARD.height)
  } else {
    const image = new Image()
    image.src = card.src
    await image.decode()
    plainCtx.drawImage(image, 0, 0, plain.width, plain.height)
  }
  // Drawn down to one pixel per cell, which averages each cell's colour.
  averaged.drawImage(plain, 0, 0, CARD.cols, CARD.rows)
  const pixels = averaged.getImageData(0, 0, CARD.cols, CARD.rows).data

  const own = new Uint8ClampedArray(CELLS * 3)
  const shuffled = new Uint8ClampedArray(CELLS * 3)
  for (let cell = 0; cell < CELLS; cell++) {
    own.set(pixels.subarray(cell * 4, cell * 4 + 3), cell * 3)
  }
  shuffledCells(card.id, CELLS).forEach((from, to) => {
    shuffled.set(own.subarray(from * 3, from * 3 + 3), to * 3)
  })

  const random = seededRandom(`${card.id}:timing`)
  const sweep = new Float32Array(CELLS)
  const scatter = new Float32Array(CELLS)
  for (let cell = 0; cell < CELLS; cell++) {
    const across = (cell % CARD.cols) / (CARD.cols - 1)
    const down = Math.floor(cell / CARD.cols) / (CARD.rows - 1)
    sweep[cell] = (across * 0.6 + down * 0.4) * 0.72 + random() * 0.28
    scatter[cell] = random()
  }
  return { plain, own, shuffled, sweep, scatter }
}

/** 0 before `start`, 1 after `start + length`, and an eased ramp between. */
function fade(progress: number, start: number, length: number): number {
  const t = Math.min(1, Math.max(0, (progress - start) / length))
  return t * t * (3 - 2 * t)
}

/** Draws the photo `progress` of the way from plain (0) to encrypted (1). */
function draw(ctx: CanvasRenderingContext2D, layers: Layers, progress: number): void {
  const { width, height } = ctx.canvas
  ctx.globalAlpha = 1
  ctx.drawImage(layers.plain, 0, 0, width, height)
  if (progress <= 0) return

  const { own, shuffled, sweep, scatter } = layers
  const cellWidth = width / CARD.cols
  const cellHeight = height / CARD.rows
  for (let cell = 0; cell < CELLS; cell++) {
    const toCell = fade(progress, (sweep[cell] as number) * TO_CELL.spread, TO_CELL.length)
    if (toCell <= 0) continue
    const toShuffled = fade(
      progress,
      TO_SHUFFLED.from + (scatter[cell] as number) * TO_SHUFFLED.spread,
      TO_SHUFFLED.length,
    )
    const at = cell * 3
    const mix = (channel: number) =>
      Math.round(
        (own[at + channel] as number) +
          ((shuffled[at + channel] as number) - (own[at + channel] as number)) * toShuffled,
      )
    ctx.fillStyle = `rgb(${mix(0)} ${mix(1)} ${mix(2)} / ${toCell})`
    ctx.fillRect(
      (cell % CARD.cols) * cellWidth,
      Math.floor(cell / CARD.cols) * cellHeight,
      cellWidth,
      cellHeight,
    )
  }
}

export function PhotoCard({
  card,
  encrypted,
  className = '',
}: {
  card: Card
  encrypted: boolean
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const layers = useRef<Layers | null>(null)
  const progress = useRef(encrypted ? 1 : 0)

  useEffect(() => {
    let live = true
    void buildLayers(card)
      .then((built) => {
        const ctx = ref.current?.getContext('2d')
        if (!live || !built || !ctx) return
        layers.current = built
        draw(ctx, built, progress.current)
      })
      // A photo that will not decode leaves its card blank, which is all
      // there is to do about it here.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [card])

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    const built = layers.current
    const target = encrypted ? 1 : 0
    // Before the card has loaded there is nothing to animate, and someone who
    // asked for less motion gets the end state, not the journey.
    if (!ctx || !built || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progress.current = target
      if (ctx && built) draw(ctx, built, target)
      return
    }
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      const delta = (now - last) / DURATION_MS
      last = now
      // From wherever it had got to, so a pointer leaving mid-way reverses
      // the animation instead of restarting it from an end.
      progress.current =
        target > progress.current
          ? Math.min(target, progress.current + delta)
          : Math.max(target, progress.current - delta)
      draw(ctx, built, progress.current)
      if (progress.current !== target) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [encrypted])

  return (
    <canvas
      ref={ref}
      width={CARD.width * SCALE}
      height={CARD.height * SCALE}
      role="img"
      aria-label={
        encrypted ? 'An encrypted file' : card.kind === 'photo' ? 'A photo' : 'A document'
      }
      className={className}
    />
  )
}
