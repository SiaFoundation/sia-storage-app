/*
 * A Mac's screen drawn in markup: a wallpaper, the menu bar with the app's
 * icon in it, and a Finder window with the library in it.
 *
 * It stands in for the real ones in onboarding, where the real Finder folder
 * may not have anything in it yet. The sidebar entry carries the name this
 * build's folder has in Finder, so what is shown is what there will be to
 * look for.
 *
 * Laid out at a size where Finder's own measurements fit, a 13 point list
 * with its four columns, then scaled down as one piece, the way the phone
 * mock is. Redrawn at the stage's size there would be room for one column.
 */

import { useEffect, useState } from 'react'
import { FILES, FOLDERS } from './library'

/** The mock screen in its own points, and how far it is scaled to fit the stage. */
const SCREEN = { width: 800, height: 520 }
const SCALE = 0.58

type Palette = {
  window: string
  edge: string
  panel: string
  chip: string
  selected: string
  stripe: string
  rule: string
  label: string
  secondary: string
  glyph: string
}

const DARK: Palette = {
  window: '#1f1f21',
  edge: 'rgba(255,255,255,0.14)',
  panel: 'rgba(255,255,255,0.055)',
  chip: 'rgba(255,255,255,0.08)',
  selected: 'rgba(255,255,255,0.13)',
  stripe: 'rgba(255,255,255,0.045)',
  rule: 'rgba(255,255,255,0.10)',
  label: 'rgba(255,255,255,0.92)',
  secondary: 'rgba(255,255,255,0.55)',
  glyph: 'rgba(255,255,255,0.80)',
}

const LIGHT: Palette = {
  window: '#ffffff',
  edge: 'rgba(0,0,0,0.12)',
  panel: 'rgba(0,0,0,0.045)',
  chip: 'rgba(0,0,0,0.055)',
  selected: 'rgba(0,0,0,0.09)',
  stripe: 'rgba(0,0,0,0.04)',
  rule: 'rgba(0,0,0,0.10)',
  label: 'rgba(0,0,0,0.88)',
  secondary: 'rgba(0,0,0,0.5)',
  glyph: 'rgba(0,0,0,0.70)',
}

/** Finder follows the system's appearance, so the mock of it does too. */
function usePalette(): Palette {
  const [light, setLight] = useState(
    () => window.matchMedia('(prefers-color-scheme: light)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setLight(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return light ? LIGHT : DARK
}

/** An 18-unit stroked glyph, the weight Finder's sidebar and toolbar draw in. */
function Glyph({
  children,
  size = 18,
  color,
  width = 1.4,
}: {
  children: React.ReactNode
  size?: number
  color: string
  width?: number
}) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

const FOLDER_PATH =
  'M2 5.2A1.6 1.6 0 0 1 3.6 3.6h3l1.5 1.6h6.3A1.6 1.6 0 0 1 16 6.8v6.6a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 13.4z'
const CLOUD_PATH = 'M5.2 13.6a3.2 3.2 0 0 1-.4-6.4 4.3 4.3 0 0 1 8.3 1.1 2.7 2.7 0 0 1-.2 5.3z'

const SIDEBAR = {
  recents: (
    <>
      <circle cx="9" cy="9" r="6.4" />
      <path d="M9 5.4V9l2.4 1.5" />
    </>
  ),
  folder: <path d={FOLDER_PATH} />,
  applications: <path d="M4.6 14.4 9 3.8l4.4 10.6M6.2 10.8h5.6M3.4 14.4h3M11.6 14.4h3" />,
  desktop: (
    <>
      <rect x="2.4" y="3.6" width="13.2" height="9" rx="1.6" />
      <path d="M6.6 15h4.8" />
    </>
  ),
  documents: <path d="M5 2.8h5.2L13.4 6v9.2H5zM10 2.8V6h3.4" />,
  downloads: (
    <>
      <circle cx="9" cy="9" r="6.4" />
      <path d="M9 5.8v6M6.6 9.6 9 12l2.4-2.4" />
    </>
  ),
  cloud: <path d={CLOUD_PATH} />,
  airdrop: (
    <>
      <circle cx="9" cy="10.2" r="1.3" />
      <path d="M5.6 12.8a4.6 4.6 0 1 1 6.8 0M3.6 14.6a7.2 7.2 0 1 1 10.8 0" />
    </>
  ),
}

/** The app's menu bar icon: three of the Sia mark's four squares, as one solid shape. */
const TrayGlyph = ({ size }: { size: number }) => (
  <svg viewBox="0 0 12 12" width={size} height={size} fill="#ffffff" aria-hidden="true">
    <path d="M0 0h12v12H6V6H0z" />
  </svg>
)

function MenuBar() {
  const white = 'rgba(255,255,255,0.95)'
  const item: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: white }
  return (
    <div
      style={{
        position: 'absolute',
        inset: '0 0 auto 0',
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 14px 0 18px',
        background: 'rgba(16,28,60,0.20)',
        textShadow: '0 0 4px rgba(0,0,0,0.25)',
      }}
    >
      <span style={{ ...item, fontWeight: 700 }}>Finder</span>
      {['File', 'Edit', 'View', 'Go', 'Window', 'Help'].map((menu) => (
        <span key={menu} style={item}>
          {menu}
        </span>
      ))}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* The app's icon, lit the way a menu bar item is while it is open:
            the one thing on the bar that is ours. */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '5px 8px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.26)',
          }}
        >
          <TrayGlyph size={13} />
        </span>
        <Glyph color={white} size={17} width={1.6}>
          <path d="M2.4 7.2a9.4 9.4 0 0 1 13.2 0M4.8 9.8a6 6 0 0 1 8.4 0M7.2 12.4a2.6 2.6 0 0 1 3.6 0" />
        </Glyph>
        <Glyph color={white} size={20} width={1.3}>
          <rect x="1.6" y="5.6" width="13" height="6.8" rx="2" />
          <rect x="3.2" y="7.2" width="8" height="3.6" rx="0.9" fill={white} stroke="none" />
          <path d="M16.2 8v2" />
        </Glyph>
        <Glyph color={white} size={16} width={1.7}>
          <circle cx="8" cy="8" r="5" />
          <path d="m11.8 11.8 3.4 3.4" />
        </Glyph>
        <Glyph color={white} size={17} width={1.5}>
          <rect x="2.4" y="3.4" width="13.2" height="4.4" rx="2.2" />
          <rect x="2.4" y="10.2" width="13.2" height="4.4" rx="2.2" />
          <circle cx="12.6" cy="5.6" r="1" fill={white} stroke="none" />
          <circle cx="5.4" cy="12.4" r="1" fill={white} stroke="none" />
        </Glyph>
        <span style={{ ...item, fontVariantNumeric: 'tabular-nums' }}>
          Mon Jun 9&nbsp;&nbsp;9:41 AM
        </span>
      </span>
    </div>
  )
}

function SidebarItem({
  palette,
  icon,
  label,
  selected,
  testId,
}: {
  palette: Palette
  icon: React.ReactNode
  label: string
  selected?: boolean
  testId?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        height: 30,
        padding: '0 10px',
        borderRadius: 8,
        background: selected ? palette.selected : 'transparent',
      }}
    >
      <Glyph color={palette.glyph}>{icon}</Glyph>
      <span
        data-testid={testId}
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: palette.label,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  )
}

const SidebarHeader = ({ palette, children }: { palette: Palette; children: string }) => (
  <div
    style={{
      margin: '12px 0 4px',
      paddingLeft: 10,
      fontSize: 11,
      fontWeight: 600,
      color: palette.secondary,
    }}
  >
    {children}
  </div>
)

/** A toolbar control: a rounded capsule holding one or more glyphs. */
const Capsule = ({ palette, children }: { palette: Palette; children: React.ReactNode }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      height: 34,
      padding: '0 11px',
      borderRadius: 17,
      background: palette.chip,
    }}
  >
    {children}
  </div>
)

const COLUMN = { date: 150, size: 62, kind: 104 }

function ListRow({
  palette,
  index,
  folder,
  name,
  modified,
  holds,
  kind,
  cloud,
}: {
  palette: Palette
  index: number
  folder: boolean
  name: string
  modified: string
  /** The Size column: a size, or Finder's two dashes for a folder. */
  holds: string
  kind: string
  cloud: boolean
}) {
  const cell: React.CSSProperties = {
    fontSize: 13,
    color: palette.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }
  return (
    <div
      // Rows arrive in order, as they do when the first sync fills the folder.
      className="animate-rise"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 24,
        margin: '0 8px',
        padding: '0 8px 0 6px',
        borderRadius: 6,
        // Finder stripes every other row, starting with the second.
        background: index % 2 === 1 ? palette.stripe : 'transparent',
        animationDelay: `${200 + index * 55}ms`,
      }}
    >
      <span style={{ width: 14, display: 'flex', flexShrink: 0 }}>
        {folder ? (
          <Glyph color={palette.secondary} size={11} width={2}>
            <path d="m6.4 3.6 5.4 5.4-5.4 5.4" />
          </Glyph>
        ) : null}
      </span>
      <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true" style={{ flexShrink: 0 }}>
        {folder ? (
          <>
            <path d={FOLDER_PATH} fill="#3d9bf3" />
            <path
              d="M2 7.2h14v6.2a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 13.4z"
              fill="#62b3ff"
            />
          </>
        ) : (
          <path
            d="M4.6 2.2h5.6l3.2 3.2v10.4H4.6zM10.2 2.2v3.2h3.2"
            fill="#f2f2f4"
            stroke="rgba(0,0,0,0.28)"
            strokeWidth="0.7"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span style={{ ...cell, flex: '1 1 auto', minWidth: 0, marginLeft: 6, color: palette.label }}>
        {name}
      </span>
      {/* The badge Finder puts on a file whose bytes are still in the cloud. */}
      <span style={{ width: 22, display: 'flex', flexShrink: 0 }}>
        {cloud ? (
          <Glyph color={palette.secondary} size={17} width={1.3}>
            <path d="M5.4 12.2a2.9 2.9 0 0 1-.3-5.8 3.9 3.9 0 0 1 7.5 1 2.5 2.5 0 0 1 .4 4.8" />
            <path d="M9 8.6v5.6M7 12.4l2 2 2-2" />
          </Glyph>
        ) : null}
      </span>
      <span style={{ ...cell, width: COLUMN.date, paddingLeft: 10 }}>{modified}</span>
      <span
        style={{
          ...cell,
          width: COLUMN.size,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {holds}
      </span>
      <span style={{ ...cell, width: COLUMN.kind, paddingLeft: 14 }}>{kind}</span>
    </div>
  )
}

function FinderWindow({ palette, finderName }: { palette: Palette; finderName: string }) {
  const header: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: palette.secondary,
    flexShrink: 0,
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: 44,
        top: 58,
        width: 712,
        height: 426,
        borderRadius: 18,
        background: palette.window,
        boxShadow: `0 0 0 1px ${palette.edge}, 0 28px 70px rgba(0,0,0,0.5)`,
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      }}
    >
      {/* The sidebar floats inside the window as a panel of its own, with the
          window's three lights on it. */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: 8,
          bottom: 8,
          width: 184,
          padding: '46px 8px 8px',
          borderRadius: 14,
          background: palette.panel,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ position: 'absolute', left: 14, top: 14, display: 'flex', gap: 8 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((light) => (
            <span
              key={light}
              style={{ width: 12, height: 12, borderRadius: 6, background: light }}
            />
          ))}
        </div>
        <SidebarItem palette={palette} icon={SIDEBAR.recents} label="Recents" />
        <SidebarItem palette={palette} icon={SIDEBAR.folder} label="Shared" />
        <SidebarHeader palette={palette}>Favorites</SidebarHeader>
        <SidebarItem palette={palette} icon={SIDEBAR.applications} label="Applications" />
        <SidebarItem palette={palette} icon={SIDEBAR.desktop} label="Desktop" />
        <SidebarItem palette={palette} icon={SIDEBAR.documents} label="Documents" />
        <SidebarItem palette={palette} icon={SIDEBAR.downloads} label="Downloads" />
        <SidebarHeader palette={palette}>Locations</SidebarHeader>
        <SidebarItem palette={palette} icon={SIDEBAR.cloud} label="iCloud Drive" />
        <SidebarItem
          palette={palette}
          icon={SIDEBAR.folder}
          label={finderName}
          selected
          testId="finder-mock-location"
        />
        <SidebarItem palette={palette} icon={SIDEBAR.airdrop} label="AirDrop" />
      </div>

      <div style={{ position: 'absolute', left: 200, top: 0, right: 0, bottom: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 34,
            margin: '12px 12px 0 4px',
          }}
        >
          <Capsule palette={palette}>
            <Glyph color={palette.glyph} size={15} width={1.9}>
              <path d="M11.2 3.6 5.8 9l5.4 5.4" />
            </Glyph>
            <Glyph color={palette.secondary} size={15} width={1.9}>
              <path d="m6.8 3.6 5.4 5.4-5.4 5.4" />
            </Glyph>
          </Capsule>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: palette.label,
              marginLeft: 4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: '1 1 auto',
              minWidth: 0,
            }}
          >
            {finderName}
          </span>
          <Capsule palette={palette}>
            <Glyph color={palette.glyph} size={17} width={1.6}>
              <path d="M6.4 5h8.6M6.4 9h8.6M6.4 13h8.6M3 5h.2M3 9h.2M3 13h.2" />
            </Glyph>
            <Glyph color={palette.glyph} size={11} width={2}>
              <path d="m5.4 6.8 3.6-3.6 3.6 3.6M5.4 11.2l3.6 3.6 3.6-3.6" />
            </Glyph>
          </Capsule>
          <Capsule palette={palette}>
            <Glyph color={palette.glyph} size={17} width={1.5}>
              <path d="M3 4.4h3v3H3zM7.6 4.4h3v3h-3zM12.2 4.4h3v3h-3zM3 10.6h3v3H3zM7.6 10.6h3v3h-3zM12.2 10.6h3v3h-3z" />
            </Glyph>
            <Glyph color={palette.glyph} size={11} width={2}>
              <path d="m5 7 4 4 4-4" />
            </Glyph>
          </Capsule>
          <Capsule palette={palette}>
            <Glyph color={palette.glyph} size={17} width={1.5}>
              <path d="M9 11V3M6 5.8 9 3l3 2.8M4.4 8.6v5.2a1.2 1.2 0 0 0 1.2 1.2h6.8a1.2 1.2 0 0 0 1.2-1.2V8.6" />
            </Glyph>
            <Glyph color={palette.glyph} size={17} width={1.5}>
              <path d="M9.6 2.8h4.6a1 1 0 0 1 1 1v4.6l-6.4 6.4a1 1 0 0 1-1.4 0L3 10.6a1 1 0 0 1 0-1.4z" />
              <circle cx="12.2" cy="5.8" r="0.9" />
            </Glyph>
            <Glyph color={palette.glyph} size={17} width={2.2}>
              <path d="M4 9h.2M9 9h.2M14 9h.2" />
            </Glyph>
          </Capsule>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              background: palette.chip,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Glyph color={palette.glyph} size={16} width={1.8}>
              <circle cx="8" cy="8" r="5" />
              <path d="m11.8 11.8 3.4 3.4" />
            </Glyph>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 26,
            margin: '14px 8px 4px',
            padding: '0 8px 0 6px',
            borderBottom: `1px solid ${palette.rule}`,
          }}
        >
          <span style={{ ...header, flex: '1 1 auto', paddingLeft: 37, color: palette.label }}>
            Name
          </span>
          <Glyph color={palette.secondary} size={10} width={2}>
            <path d="m4.6 11 4.4-4.4 4.4 4.4" />
          </Glyph>
          <span style={{ width: 12 }} />
          {(
            [
              ['Date Modified', COLUMN.date, 10, 'left'],
              ['Size', COLUMN.size, 0, 'right'],
              ['Kind', COLUMN.kind, 14, 'left'],
            ] as const
          ).map(([title, width, indent, align]) => (
            <span
              key={title}
              style={{
                ...header,
                width,
                paddingLeft: indent,
                textAlign: align,
                boxSizing: 'border-box',
                borderLeft: `1px solid ${palette.rule}`,
              }}
            >
              {title}
            </span>
          ))}
        </div>

        {FOLDERS.map((folder, index) => (
          <ListRow
            key={folder.name}
            palette={palette}
            index={index}
            folder
            name={folder.name}
            modified={folder.modified}
            holds="--"
            kind="Folder"
            cloud
          />
        ))}
        {FILES.map((file, index) => (
          <ListRow
            key={file.name}
            palette={palette}
            index={FOLDERS.length + index}
            folder={false}
            name={file.name}
            modified={file.modified}
            holds={file.size}
            kind={file.kind}
            cloud={!file.downloaded}
          />
        ))}
      </div>
    </div>
  )
}

export function FinderMock({ finderName }: { finderName: string }) {
  const palette = usePalette()
  return (
    <div
      data-testid="finder-mock"
      role="img"
      aria-label={`A Mac's screen: the Sia Storage icon in the menu bar, and a Finder window open on ${finderName}`}
      style={{
        width: SCREEN.width * SCALE,
        height: SCREEN.height * SCALE,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.10), 0 16px 40px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: SCREEN.width,
          height: SCREEN.height,
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
          // A wallpaper in the manner of macOS's own: one hue, lit from a corner.
          background: [
            'radial-gradient(90% 70% at 88% 112%, rgba(150,205,255,0.60) 0%, rgba(150,205,255,0) 60%)',
            'radial-gradient(80% 90% at 0% 0%, #74a8ea 0%, rgba(116,168,234,0) 65%)',
            'linear-gradient(160deg, #3f78c8 0%, #2a5cab 45%, #1b3f86 100%)',
          ].join(', '),
        }}
      >
        <MenuBar />
        <FinderWindow palette={palette} finderName={finderName} />
      </div>
    </div>
  )
}
