import { useEffect, useRef, useState } from 'react'
import {
  type Category,
  type SortBy,
  useViewSettings,
  useViewSettingsStore,
} from '../../stores/viewSettings'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'DATE', label: 'Date Created' },
  { value: 'ADDED', label: 'Date Added' },
  { value: 'NAME', label: 'Name' },
  { value: 'SIZE', label: 'Size' },
]

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'Image', label: 'Photos' },
  { value: 'Video', label: 'Videos' },
  { value: 'Audio', label: 'Audio' },
  { value: 'Files', label: 'Files' },
]

type ViewSettingsMenuProps = {
  scope: string
  sortOptions?: { value: SortBy; label: string }[]
  showCategoryFilter?: boolean
}

export function ViewSettingsMenu({
  scope,
  sortOptions = SORT_OPTIONS,
  showCategoryFilter = true,
}: ViewSettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const settings = useViewSettings(scope)
  const setViewMode = useViewSettingsStore((s) => s.setViewMode)
  const setSortBy = useViewSettingsStore((s) => s.setSortBy)
  const setSortDir = useViewSettingsStore((s) => s.setSortDir)
  const toggleCategory = useViewSettingsStore((s) => s.toggleCategory)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors flex items-center gap-1.5"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <title>View settings</title>
          <path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6M9 8h6M17 16h6" />
        </svg>
        View
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-30 py-2 overflow-hidden">
          <Section label="Sort by">
            {sortOptions.map((opt) => (
              <RadioItem
                key={opt.value}
                label={opt.label}
                selected={settings.sortBy === opt.value}
                onClick={() => setSortBy(scope, opt.value)}
              />
            ))}
          </Section>

          <Divider />

          <Section label="Direction">
            <RadioItem
              label="Ascending"
              selected={settings.sortDir === 'ASC'}
              onClick={() => setSortDir(scope, 'ASC')}
            />
            <RadioItem
              label="Descending"
              selected={settings.sortDir === 'DESC'}
              onClick={() => setSortDir(scope, 'DESC')}
            />
          </Section>

          {showCategoryFilter && (
            <>
              <Divider />

              <Section label="Filter">
                {CATEGORY_OPTIONS.map((opt) => (
                  <CheckboxItem
                    key={opt.value}
                    label={opt.label}
                    checked={settings.selectedCategories.includes(opt.value)}
                    onClick={() => toggleCategory(scope, opt.value)}
                  />
                ))}
              </Section>
            </>
          )}

          <Divider />

          <Section label="View">
            <RadioItem
              label="Gallery"
              selected={settings.viewMode === 'gallery'}
              onClick={() => setViewMode(scope, 'gallery')}
            />
            <RadioItem
              label="List"
              selected={settings.viewMode === 'list'}
              onClick={() => setViewMode(scope, 'list')}
            />
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="px-1">
      <p className="px-3 py-1 text-xs font-medium text-neutral-500 uppercase tracking-wider">
        {label}
      </p>
      {children}
    </div>
  )
}

function Divider() {
  return <div className="my-1 border-t border-neutral-800" />
}

function RadioItem({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 hover:bg-neutral-800 rounded-lg transition-colors"
    >
      <span
        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
          selected ? 'border-green-500' : 'border-neutral-600'
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-green-500" />}
      </span>
      <span className={selected ? 'text-white' : 'text-neutral-400'}>
        {label}
      </span>
    </button>
  )
}

function CheckboxItem({
  label,
  checked,
  onClick,
}: {
  label: string
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 hover:bg-neutral-800 rounded-lg transition-colors"
    >
      <span
        className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
          checked ? 'bg-green-600 border-green-600' : 'border-neutral-600'
        }`}
      >
        {checked && (
          <svg
            className="w-2.5 h-2.5 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <title>Checked</title>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span className={checked ? 'text-white' : 'text-neutral-400'}>
        {label}
      </span>
    </button>
  )
}
