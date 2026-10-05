/*
 * Where the pieces go: straight from this Mac to 30 storage providers around
 * the world, one piece each. Nothing sits between them, which is the point of
 * the picture.
 *
 * `offline` fades 20 of the providers, the most that can be unreachable with
 * the file still readable.
 */

import { COASTLINE } from './coastline'
import { KEPT, PIECES, ShardGlyph } from './ShardField'
import { seededShard } from './shards'

/** The part of the 720 x 360 map that is shown: the poles are left off. */
const VIEW = { x: 24, y: 44, width: 672, height: 236 }
const WIDTH = 440
const SCALE = WIDTH / VIEW.width
const MAP_HEIGHT = VIEW.height * SCALE
const HEIGHT = 300
/** The Mac sits under the map, so it is not on any one place in it. */
const MAC = { x: WIDTH / 2, y: HEIGHT - 34 }

/** One provider per piece, as [longitude, latitude], spread the way real ones are. */
const PLACES: Array<[number, number]> = [
  [-122.3, 47.6],
  [-118.2, 34.1],
  [-105, 39.7],
  [-96.8, 32.8],
  [-87.6, 41.9],
  [-74, 40.7],
  [-80.2, 25.8],
  [-99.1, 19.4],
  [-74.1, 4.7],
  [-46.6, -23.5],
  [-70.7, -33.4],
  [-6.3, 53.3],
  [-3.7, 40.4],
  [2.3, 48.9],
  [18.1, 59.3],
  [21, 52.2],
  [12.5, 41.9],
  [29, 41],
  [3.4, 6.5],
  [36.8, -1.3],
  [18.4, -33.9],
  [55.3, 25.2],
  [72.9, 19.1],
  [82.9, 55],
  [103.8, 1.4],
  [114.2, 22.3],
  [127, 37.5],
  [139.7, 35.7],
  [151.2, -33.9],
  [174.8, -36.8],
]

const POINTS = PLACES.map(([longitude, latitude]) => ({
  x: ((longitude + 180) * 2 - VIEW.x) * SCALE,
  y: ((90 - latitude) * 2 - VIEW.y) * SCALE,
}))

/** How long a piece takes to reach its provider, and the gap between departures. */
const FLIGHT_MS = 700
const GAP_MS = 60

export function Providers({ offline }: { offline: boolean }) {
  return (
    <div
      role="img"
      aria-label={`This Mac sending one piece to each of ${PIECES.toLocaleString()} storage providers around the world`}
      className="relative"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <svg
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
        width={WIDTH}
        height={MAP_HEIGHT}
        className="absolute top-0 left-0 text-label"
        aria-hidden="true"
      >
        <path
          d={COASTLINE}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
          opacity="0.26"
        />
      </svg>

      {POINTS.map((point, index) => {
        const departs = 250 + index * GAP_MS
        const color = seededShard(`piece-${index}`)[0]?.color
        return (
          <span key={index}>
            {/* The piece on its way. It starts on the Mac, and the offset is
                the way back there, which is where the keyframe begins. */}
            <span
              className="absolute animate-send"
              style={
                {
                  left: point.x - 7,
                  top: point.y - 7,
                  '--from-x': `${MAC.x - point.x}px`,
                  '--from-y': `${MAC.y - point.y}px`,
                  animationDuration: `${FLIGHT_MS}ms`,
                  animationDelay: `${departs}ms`,
                } as React.CSSProperties
              }
            >
              <ShardGlyph index={index} size={14} />
            </span>
            {/* The provider, lit in its piece's colour once the piece lands.
                The fade for `offline` is on an inner element, so the arrival
                animation and that transition never act on one element's
                opacity. */}
            <span
              className="absolute animate-arrive"
              style={{
                left: point.x - 3,
                top: point.y - 3,
                animationDelay: `${departs + FLIGHT_MS - 120}ms`,
              }}
            >
              <span
                className="block size-[6px] rounded-full shadow-[0_0_0_1px_rgb(0_0_0/25%)] transition-opacity duration-300 ease-settle"
                style={{ background: color, opacity: offline && !KEPT.has(index) ? 0.16 : 1 }}
              />
            </span>
          </span>
        )
      })}

      <span
        className="absolute flex size-[48px] items-center justify-center rounded-full bg-menu shadow-[0_0_0_1px_var(--color-divider),0_6px_18px_rgb(0_0_0/25%)]"
        style={{ left: MAC.x - 24, top: MAC.y - 24 }}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4.5" y="5" width="15" height="10" rx="1.6" />
          <path d="M2.5 18.5h19" />
        </svg>
      </span>
    </div>
  )
}
