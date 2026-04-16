import type { DirectoryResponse } from '../lib/api'
import { Panel, PanelBody, PanelEmpty } from '../components/panel'
import { FileTable } from '../components/file-table'

type DirectoryPageProps = {
  path: string
  data: DirectoryResponse
}

export function DirectoryPage({ path, data }: DirectoryPageProps) {
  const hasContent = data.directories.length > 0 || data.files.length > 0

  return (
    <Panel>
      {hasContent ? (
        <PanelBody>
          <FileTable
            path={path}
            directories={data.directories}
            files={data.files}
            downloadEnabled={data.downloadEnabled}
          />
        </PanelBody>
      ) : (
        <PanelEmpty>Empty directory</PanelEmpty>
      )}
    </Panel>
  )
}
