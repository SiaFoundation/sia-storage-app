import type { ShareMetadata } from '../lib/api'
import { Panel, PanelHeader, PanelBody } from '../components/panel'
import { NavActions } from '../components/nav-actions'

type MetadataPageProps = {
  path: string
  metadata: ShareMetadata
}

export function MetadataPage({ path, metadata }: MetadataPageProps) {
  const json = JSON.stringify(metadata, null, 2)

  function handleCopy() {
    navigator.clipboard.writeText(json)
  }

  return (
    <Panel>
      <PanelHeader>
        <span className="font-mono">Object metadata</span>
        <NavActions rawHref={`${path}?share`} onCopy={handleCopy} />
      </PanelHeader>
      <PanelBody>
        <pre className="p-4 overflow-x-auto text-sm leading-relaxed m-0">
          <code>{json}</code>
        </pre>
      </PanelBody>
    </Panel>
  )
}
