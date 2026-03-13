import { useAllTags } from '@siastorage/core/stores'
import { navigate } from '../../lib/router'
import { useModalStore } from '../../stores/modal'
import { useViewSettings } from '../../stores/viewSettings'
import { ContentLayout } from '../layout/ContentLayout'
import { ViewToolbar } from '../layout/ViewToolbar'
import { TagsGrid } from '../library/TagsGrid'
import { ViewSettingsMenu } from '../library/ViewSettingsMenu'

const SORT_OPTIONS = [{ value: 'NAME' as const, label: 'Name' }]

export function TagsPage() {
  const { data: tagsData } = useAllTags()
  const tags = tagsData ?? []
  const loaded = tagsData !== undefined
  const openCreateTag = useModalStore((s) => s.openCreateTag)
  const { viewMode, sortDir } = useViewSettings('tags')

  return (
    <>
      {loaded && (
        <ViewToolbar
          title="Tags"
          count={tags.length}
          countLabel={`tag${tags.length !== 1 ? 's' : ''}`}
        >
          <ViewSettingsMenu
            scope="tags"
            sortOptions={SORT_OPTIONS}
            showCategoryFilter={false}
          />
          <button
            type="button"
            onClick={openCreateTag}
            className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>New tag</title>
              <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
              <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
              <path d="M16 2v6" />
              <path d="M13 5h6" />
            </svg>
            New Tag
          </button>
        </ViewToolbar>
      )}
      <ContentLayout>
        <TagsGrid
          onSelectTag={(id) => navigate(`#/tag/${id}`)}
          viewMode={viewMode}
          sortDir={sortDir}
        />
      </ContentLayout>
    </>
  )
}
