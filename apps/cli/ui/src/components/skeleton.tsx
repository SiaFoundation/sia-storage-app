import { Panel, PanelBody } from './panel'

function Bar({ className = '' }: { className?: string }) {
  return <div className={`h-4 bg-gray-100 rounded animate-pulse ${className}`} />
}

export function DirectorySkeleton() {
  return (
    <Panel>
      <PanelBody>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
                Name
              </th>
              <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
                Type
              </th>
              <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
                Size
              </th>
              <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
                Modified
              </th>
              <th className="px-4 py-2 border-b border-gray-200"></th>
            </tr>
          </thead>
          <tbody>
            {[...Array(4)].map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3 border-b border-gray-100">
                  <Bar className="w-32" />
                </td>
                <td className="px-4 py-3 border-b border-gray-100">
                  <Bar className="w-16" />
                </td>
                <td className="px-4 py-3 border-b border-gray-100">
                  <Bar className="w-12" />
                </td>
                <td className="px-4 py-3 border-b border-gray-100">
                  <Bar className="w-14" />
                </td>
                <td className="px-4 py-3 border-b border-gray-100">
                  <Bar className="w-6" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelBody>
    </Panel>
  )
}

export function ViewerSkeleton() {
  return (
    <Panel>
      <div className="px-4 py-3 border-b border-gray-200 flex gap-3">
        <Bar className="w-16" />
        <Bar className="w-12" />
        <Bar className="w-14" />
      </div>
      <div className="p-8 flex items-center justify-center" style={{ minHeight: '200px' }}>
        <Bar className="w-48 h-8" />
      </div>
    </Panel>
  )
}
