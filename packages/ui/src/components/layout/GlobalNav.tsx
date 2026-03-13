import { navigate, useRoute } from '../../lib/router'
import { useModalStore } from '../../stores/modal'
import { SyncStatus } from '../library/SyncStatus'
import { UploadMenu } from '../library/UploadMenu'
import { useUploadsBadgeCount } from '../library/UploadsPanel'

type Tab = 'media' | 'files' | 'tags' | 'uploads'

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'files', label: 'Files', path: '#/files' },
  { id: 'tags', label: 'Tags', path: '#/tags' },
  { id: 'media', label: 'Media', path: '#/media' },
  { id: 'uploads', label: 'Uploads', path: '#/uploads' },
]

export function GlobalNav({
  onLocalThumbnails,
  showLogo = true,
}: {
  onLocalThumbnails?: (urls: Record<string, string>) => void
  showLogo?: boolean
}) {
  const route = useRoute()
  const openStatus = useModalStore((s) => s.openStatus)
  const uploadsBadgeCount = useUploadsBadgeCount()

  const activeTab: Tab | null =
    route.type === 'library'
      ? route.tab
      : route.type === 'directory'
        ? 'files'
        : route.type === 'tag'
          ? 'tags'
          : null

  return (
    <header className="sticky top-0 z-20 h-12 bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-full flex items-center gap-2 sm:gap-3">
        {showLogo && (
          <button
            type="button"
            onClick={() => navigate('#/')}
            className="w-7 h-7 rounded-lg overflow-hidden hover:opacity-80 transition-opacity flex-shrink-0"
            title="Home"
            data-testid="nav-home"
          >
            <img
              src="/icon.png"
              alt="Sia"
              className="w-full h-full object-cover"
            />
          </button>
        )}

        <nav className="flex items-center gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tab.path)}
              data-testid={`nav-${tab.id}`}
              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-lg transition-colors relative ${
                activeTab === tab.id
                  ? 'text-white bg-neutral-800/60'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
              {tab.id === 'uploads' && uploadsBadgeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] bg-green-600 text-white text-[10px] font-medium rounded-full flex items-center justify-center px-1">
                  {uploadsBadgeCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate('#/search')}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors rounded-lg hover:bg-neutral-800"
            title="Search (Ctrl+K)"
            data-testid="nav-search"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Search</title>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          <UploadMenu onLocalThumbnails={onLocalThumbnails} />

          <button
            type="button"
            onClick={openStatus}
            className="flex items-center flex-shrink-0 p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <SyncStatus />
          </button>

          <button
            type="button"
            onClick={() => navigate('#/settings')}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors rounded-lg hover:bg-neutral-800"
            title="Settings"
            data-testid="nav-settings"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Settings</title>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
