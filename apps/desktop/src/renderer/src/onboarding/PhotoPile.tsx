/*
 * A loose pile of photos and documents, which is what a library is before
 * anything is done to it. Each card can be shown encrypted, and the pile has
 * three ways of deciding which.
 */

import { useEffect, useState } from 'react'
import { CARDS } from './cards'
import { PhotoCard } from './PhotoCard'

/** Where each card sits in the pile, back to front: offset in px, tilt in degrees. */
const PLACES = [
  { x: -74, y: -52, tilt: -8 },
  { x: 62, y: -58, tilt: 5 },
  { x: -6, y: -14, tilt: -3 },
  { x: -82, y: 40, tilt: 4 },
  { x: 72, y: 26, tilt: -6 },
  { x: -2, y: 58, tilt: 2 },
]

/** The gap between one card encrypting and the next, so the eye can follow each. */
const STAGGER_MS = 240

export function PhotoPile({
  mode,
}: {
  /**
   * `preview` shows the cards and encrypts the one under the pointer.
   * `encrypt` encrypts every card in turn and shows the original of the one
   * under the pointer, as only the key's holder can. `encrypted` shows every
   * card encrypted and leaves it so.
   */
  mode: 'preview' | 'encrypt' | 'encrypted'
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  /** How many cards have been encrypted so far, counting from the back. */
  const [sealed, setSealed] = useState(0)

  useEffect(() => {
    if (mode !== 'encrypt') {
      setSealed(0)
      return
    }
    if (sealed >= CARDS.length) return
    const timer = setTimeout(() => setSealed((count) => count + 1), STAGGER_MS)
    return () => clearTimeout(timer)
  }, [mode, sealed])

  return (
    <div className="relative h-[280px] w-[360px]" onPointerLeave={() => setHovered(null)}>
      {CARDS.map((card, index) => {
        const place = PLACES[index] as (typeof PLACES)[number]
        const isHovered = hovered === index
        const encrypted =
          mode === 'encrypted'
            ? true
            : mode === 'preview'
              ? isHovered
              : index < sealed && !isHovered
        return (
          <div
            key={card.id}
            onPointerEnter={() => setHovered(index)}
            className="absolute top-1/2 left-1/2 transition-[translate,rotate,scale] duration-150 ease-settle"
            style={{
              // A lifted card straightens and comes forward, the way one
              // picked out of a pile does.
              translate: `calc(-50% + ${place.x}px) calc(-50% + ${place.y - (isHovered ? 8 : 0)}px)`,
              rotate: `${isHovered ? 0 : place.tilt}deg`,
              scale: isHovered ? '1.04' : '1',
              zIndex: isHovered ? CARDS.length : index,
            }}
          >
            <PhotoCard
              card={card}
              encrypted={encrypted}
              className="block h-[112px] w-[168px] rounded-[7px] shadow-[0_10px_28px_rgb(0_0_0/38%)] outline outline-1 outline-white/15 [@media(prefers-color-scheme:light)]:outline-black/10"
            />
          </div>
        )
      })}
    </div>
  )
}
