import type { Category, SortBy } from '@siastorage/core/db/operations'
import type React from 'react'
import { useMemo } from 'react'
import { categories } from '../stores/library'
import {
  setSortBy,
  setSortDir,
  setViewMode,
  toggleCategory,
  useViewSettings,
} from '../stores/viewSettings'
import { DropdownMenu, type MenuItem } from './DropdownMenu'

const CATEGORY_LABELS: Record<string, string> = {
  Video: 'Videos',
  Image: 'Photos',
  Audio: 'Audio',
  Files: 'Files',
}

type Props = {
  children: React.ReactNode
  scope?: string
  allowedCategories?: readonly Category[]
}

export function ViewSettingsMenu({
  children,
  scope = 'library',
  allowedCategories,
}: Props) {
  const vs = useViewSettings(scope)
  const visibleCategories = allowedCategories ?? categories

  const items: MenuItem[] = useMemo(() => {
    const categorySet = new Set(vs.selectedCategories)
    const sortOptions: { key: string; label: string; value: SortBy }[] = [
      { key: 'sort-date', label: 'Date Created', value: 'DATE' },
      { key: 'sort-added', label: 'Date Added', value: 'ADDED' },
      { key: 'sort-name', label: 'Name', value: 'NAME' },
      { key: 'sort-size', label: 'Size', value: 'SIZE' },
    ]

    return [
      ...sortOptions.map(
        (opt): MenuItem => ({
          type: 'checkbox',
          key: opt.key,
          label: opt.label,
          checked: vs.sortBy === opt.value,
          onPress: () => setSortBy(scope, opt.value),
        }),
      ),
      { type: 'separator' },
      {
        type: 'checkbox',
        key: 'dir-asc',
        label: 'Ascending',
        checked: vs.sortDir === 'ASC',
        onPress: () => setSortDir(scope, 'ASC'),
      },
      {
        type: 'checkbox',
        key: 'dir-desc',
        label: 'Descending',
        checked: vs.sortDir === 'DESC',
        onPress: () => setSortDir(scope, 'DESC'),
      },
      { type: 'separator' },
      {
        type: 'submenu',
        key: 'filter',
        label: 'Filter',
        items: visibleCategories.map(
          (cat): MenuItem => ({
            type: 'checkbox',
            key: `filter-${cat}`,
            label: CATEGORY_LABELS[cat] ?? cat,
            checked: categorySet.has(cat),
            onPress: () => toggleCategory(scope, cat),
          }),
        ),
      },
      { type: 'separator' },
      {
        type: 'checkbox',
        key: 'view-gallery',
        label: 'Gallery',
        checked: vs.viewMode === 'gallery',
        onPress: () => setViewMode(scope, 'gallery'),
      },
      {
        type: 'checkbox',
        key: 'view-list',
        label: 'List',
        checked: vs.viewMode === 'list',
        onPress: () => setViewMode(scope, 'list'),
      },
    ]
  }, [
    scope,
    vs.sortBy,
    vs.sortDir,
    vs.viewMode,
    vs.selectedCategories,
    visibleCategories,
  ])

  return <DropdownMenu trigger={children} items={items} />
}
