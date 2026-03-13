import { useAllDirectories } from '@siastorage/core/stores'
import { navigate } from '../../lib/router'
import { useModalStore } from '../../stores/modal'
import { useViewSettings } from '../../stores/viewSettings'
import { ContentLayout } from '../layout/ContentLayout'
import { ViewToolbar } from '../layout/ViewToolbar'
import { DirectoriesGrid } from '../library/DirectoriesGrid'
import { ViewSettingsMenu } from '../library/ViewSettingsMenu'

const SORT_OPTIONS = [{ value: 'NAME' as const, label: 'Name' }]

export function FilesPage() {
  const { data: directoriesData } = useAllDirectories()
  const directories = directoriesData ?? []
  const loaded = directoriesData !== undefined
  const openCreateDirectory = useModalStore((s) => s.openCreateDirectory)
  const { viewMode, sortDir } = useViewSettings('directories')

  return (
    <>
      {loaded && (
        <ViewToolbar
          title="Files"
          count={directories.length}
          countLabel={`folder${directories.length !== 1 ? 's' : ''}`}
        >
          <ViewSettingsMenu
            scope="directories"
            sortOptions={SORT_OPTIONS}
            showCategoryFilter={false}
          />
          <button
            type="button"
            onClick={openCreateDirectory}
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
              <title>New folder</title>
              <path d="M12 10v6" />
              <path d="M9 13h6" />
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
            </svg>
            New Folder
          </button>
        </ViewToolbar>
      )}
      <ContentLayout>
        <DirectoriesGrid
          onSelectDirectory={(id) => navigate(`#/dir/${id}`)}
          viewMode={viewMode}
          sortDir={sortDir}
        />
      </ContentLayout>
    </>
  )
}
