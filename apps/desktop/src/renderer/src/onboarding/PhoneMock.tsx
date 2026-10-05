/*
 * An iPhone showing the mobile app's Files tab, with the same library the
 * Finder mock shows.
 *
 * Laid out at a phone's size in points, with the sizes, weights and colours
 * the mobile app's `LibraryHeader`, `LibraryAppStatusIcon`, `DirectoriesGrid`
 * and `LibraryTabBar` use, then scaled down as one piece. That keeps the
 * proportions the app's own, where redrawing it small would drift from them.
 */

import { FILES, FOLDERS } from './library'

/** An iPhone's screen in points. */
const SCREEN = { width: 393, height: 852 }
const SCALE = 0.5
const BEZEL = 10

const WHITE = '#ffffff'
const WHITE_50 = 'rgba(255,255,255,0.50)'
const WHITE_10 = 'rgba(255,255,255,0.10)'
const WHITE_08 = 'rgba(255,255,255,0.08)'
const PILL = 'rgba(28,30,33,0.75)'
const PANEL = 'rgba(18,20,23,0.90)'
const BLUE = '#58a6ff'
const GRAY = '#9aa4af'
const GREEN = '#22c55e'
const CANVAS = '#0b0d10'

type IconProps = { size: number; color: string; children: React.ReactNode }

/** A 24-unit stroked icon, the shape the mobile app's icon set draws in. */
const Icon = ({ size, color, children }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const FOLDER = (
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
)

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  borderBottom: `0.5px solid ${WHITE_10}`,
}

function FolderRow({ name, holds, unfiled }: { name: string; holds: string; unfiled?: boolean }) {
  return (
    <div style={row}>
      {unfiled ? (
        <Icon size={24} color={GRAY}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </Icon>
      ) : (
        <Icon size={24} color={BLUE}>
          {FOLDER}
        </Icon>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: WHITE, fontSize: 16, fontWeight: 700 }}>{name}</div>
        <div style={{ color: WHITE_50, fontSize: 13 }}>{holds}</div>
      </div>
    </div>
  )
}

const plural = (count: number, one: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : `${one}s`}`

const floating: React.CSSProperties = {
  height: 56,
  borderRadius: 26,
  background: PANEL,
  border: `0.5px solid ${WHITE_08}`,
  boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
}

export function PhoneMock() {
  return (
    <div
      data-testid="phone-mock"
      role="img"
      aria-label="The Sia Storage app on a phone, showing the same folders"
      style={{
        width: (SCREEN.width + BEZEL * 2) * SCALE,
        height: (SCREEN.height + BEZEL * 2) * SCALE,
      }}
    >
      <div
        style={{
          width: SCREEN.width + BEZEL * 2,
          height: SCREEN.height + BEZEL * 2,
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
          padding: BEZEL,
          borderRadius: 64,
          background: '#1b1b1d',
          boxShadow: '0 0 0 2px #3a3a3d, 0 30px 70px rgba(0,0,0,0.45)',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: SCREEN.width,
            height: SCREEN.height,
            borderRadius: 54,
            overflow: 'hidden',
            background: CANVAS,
            color: WHITE,
            fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 11,
              left: '50%',
              width: 124,
              height: 36,
              marginLeft: -62,
              borderRadius: 20,
              background: '#000000',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '19px 34px 0',
              fontSize: 17,
              fontWeight: 600,
            }}
          >
            <span>9:41</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 18, height: 11, borderRadius: 2, background: WHITE }} />
              <span style={{ width: 26, height: 12, borderRadius: 4, background: WHITE }} />
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '22px 16px 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  background: PILL,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon size={22} color={WHITE}>
                  <path d="M4 5h16M4 12h16M4 19h16" />
                </Icon>
              </div>
              <div>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: '38px' }}>Files</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                  {plural(FOLDERS.length, 'folder')}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{ padding: '8px 14px', borderRadius: 18, background: PILL, display: 'flex' }}
              >
                <Icon size={18} color={GREEN}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </Icon>
              </div>
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 18,
                  background: PILL,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Select
              </div>
            </div>
          </div>

          <div style={{ padding: '26px 16px 0' }}>
            {FOLDERS.map((folder) => (
              <FolderRow
                key={folder.name}
                name={folder.name}
                holds={
                  plural(folder.files, 'file') +
                  (folder.folders > 0 ? `, ${plural(folder.folders, 'folder')}` : '')
                }
              />
            ))}
            <FolderRow name="No folder" holds={plural(FILES.length, 'file')} unfiled />
          </div>

          <div
            style={{
              position: 'absolute',
              left: '5%',
              right: '5%',
              bottom: 30,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ ...floating, padding: 4, position: 'relative' }}>
              {/* The indicator sits under the middle segment, Files. */}
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  bottom: 4,
                  left: 4 + 64,
                  width: 64,
                  borderRadius: 22,
                  background: WHITE_10,
                }}
              />
              {[
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </>,
                FOLDER,
                <>
                  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
                  <circle cx="7.5" cy="7.5" r=".5" fill={WHITE_50} />
                </>,
              ].map((icon, index) => (
                <div
                  key={index}
                  style={{
                    width: 64,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <Icon size={20} color={index === 1 ? WHITE : WHITE_50}>
                    {icon}
                  </Icon>
                </div>
              ))}
            </div>
            <div style={{ ...floating, padding: '0 16px', gap: 18 }}>
              <Icon size={20} color={WHITE}>
                {FOLDER}
                <path d="M12 10v6M9 13h6" />
              </Icon>
              <Icon size={22} color={WHITE}>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </Icon>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
