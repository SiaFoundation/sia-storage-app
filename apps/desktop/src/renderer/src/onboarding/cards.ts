/*
 * What is in the pile onboarding shows: three photos and three documents, the
 * mix a library holds.
 *
 * The photos are NASA images, which are in the public domain. The documents
 * are painted here rather than shipped, since a page drawn as blocks of text
 * and a chart reads as a document at the size of a card, where a real one
 * would be grey noise.
 *
 * Each card can be turned into what an encrypted file looks like: its own
 * colours as a grid of cells, in a shuffled order.
 */

import aurora from '../assets/onboarding/aurora.jpg'
import earth from '../assets/onboarding/earth.jpg'
import saturn from '../assets/onboarding/saturn.jpg'
import { seededRandom } from './shards'

type Ctx = CanvasRenderingContext2D

export type Card =
  | { id: string; kind: 'photo'; src: string }
  | { id: string; kind: 'document'; paint: (ctx: Ctx, w: number, h: number) => void }

/** The size a card is drawn at, and the grid its encrypted form is cut to. */
export const CARD = { width: 300, height: 200, cols: 15, rows: 10 }

/**
 * Where each cell of the grid is drawn once the card is encrypted: a
 * permutation of the cell indexes, the same one for a seed every time.
 */
export function shuffledCells(seed: string, count: number): number[] {
  const random = seededRandom(seed)
  const order = Array.from({ length: count }, (_, index) => index)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return order
}

/** A run of text, drawn as the bar it is at this size. */
function line(ctx: Ctx, x: number, y: number, width: number, height = 5): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, height / 2)
  ctx.fill()
}

/** The file type, as the small label a document's icon carries. */
function tag(ctx: Ctx, text: string, color: string, h: number): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(18, h - 40, 44, 22, 5)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 12px -apple-system, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 40, h - 28.5)
}

/** A report: a heading, a column of text and a bar chart. */
function report(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f7f6f3'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#1f2328'
  line(ctx, 18, 20, 132, 9)
  ctx.fillStyle = '#b9bdc4'
  const random = seededRandom('report')
  for (let row = 0; row < 7; row++) line(ctx, 18, 46 + row * 13, 112 + random() * 36)

  const bars = ['#e50aae', '#ff7919', '#36d955', '#76e6eb', '#c3e500']
  bars.forEach((color, index) => {
    const height = 28 + random() * 70
    ctx.fillStyle = color
    ctx.fillRect(196 + index * 18, 132 - height, 12, height)
  })
  ctx.fillStyle = '#1f2328'
  ctx.fillRect(190, 132, 96, 1.5)
  tag(ctx, 'PDF', '#e5484d', h)
}

/** A spreadsheet: a header row, a grid, and figures as bars in the cells. */
function sheet(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#1f8f4d'
  ctx.fillRect(0, 0, w, 26)
  ctx.fillStyle = '#eef6f0'
  ctx.fillRect(0, 26, 62, h - 26)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  for (let column = 0; column < 4; column++) line(ctx, 74 + column * 58, 10, 34, 6)
  const random = seededRandom('sheet')
  for (let row = 0; row < 7; row++) {
    const y = 38 + row * 20
    ctx.fillStyle = '#7d8b84'
    line(ctx, 10, y, 30 + random() * 16)
    ctx.fillStyle = row === 6 ? '#1f2328' : '#b9bdc4'
    for (let column = 0; column < 4; column++) {
      const width = 14 + random() * 26
      line(ctx, 74 + column * 58 + (40 - width), y, width)
    }
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
  for (let row = 0; row <= 7; row++) ctx.fillRect(0, 26 + row * 20 + 6, w, 1)
  for (let column = 0; column < 4; column++) ctx.fillRect(62 + column * 58, 26, 1, h - 26)
  tag(ctx, 'XLS', '#1f8f4d', h)
}

/** Notes: a heading, paragraphs, and one line marked with a highlighter. */
function notes(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#fbf7ec'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#2b2f36'
  line(ctx, 22, 22, 150, 10)
  const random = seededRandom('notes')
  for (let row = 0; row < 9; row++) {
    const y = 50 + row * 13
    const width = row % 4 === 3 ? 90 + random() * 60 : 210 + random() * 44
    if (row === 4) {
      ctx.fillStyle = '#ffe45c'
      ctx.fillRect(18, y - 4, width + 8, 13)
    }
    ctx.fillStyle = '#b3aea0'
    line(ctx, 22, y, width)
  }
  tag(ctx, 'DOC', '#3b82f6', h)
}

/** Back to front, alternating, so neither kind hides the other. */
export const CARDS: Card[] = [
  { id: 'earth', kind: 'photo', src: earth },
  { id: 'report', kind: 'document', paint: report },
  { id: 'saturn', kind: 'photo', src: saturn },
  { id: 'sheet', kind: 'document', paint: sheet },
  { id: 'aurora', kind: 'photo', src: aurora },
  { id: 'notes', kind: 'document', paint: notes },
]
