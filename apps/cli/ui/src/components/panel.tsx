import type { ReactNode } from 'react'

export function Panel({ children }: { children: ReactNode }) {
  return <div className="border border-gray-200 rounded-lg overflow-hidden mt-4">{children}</div>
}

export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-gray-200 text-sm text-gray-500 flex items-center justify-between">
      {children}
    </div>
  )
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div>{children}</div>
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-gray-400">{children}</div>
}
