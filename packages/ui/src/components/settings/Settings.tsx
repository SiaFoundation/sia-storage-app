import { useState } from 'react'
import { AccountTab } from './AccountTab'
import { AdvancedTab } from './AdvancedTab'

type Tab = 'account' | 'advanced'

const tabs: { id: Tab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'advanced', label: 'Advanced' },
]

export function Settings() {
  const [tab, setTab] = useState<Tab>('account')

  return (
    <div
      className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row"
      style={{ height: 'calc(100vh - 48px)' }}
    >
      <aside className="md:w-52 md:shrink-0 md:border-r border-b md:border-b-0 border-neutral-800 py-2 md:py-4 px-0 md:px-3">
        <h2 className="hidden md:block px-3 text-xs text-neutral-500 uppercase tracking-wider mb-3">
          Settings
        </h2>
        <nav className="flex flex-row md:flex-col gap-0.5 px-3 md:px-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm rounded-lg text-left transition-colors ${
                tab === t.id
                  ? 'text-white bg-neutral-800'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto py-6 md:py-8 px-0 md:px-8">
        <div className="max-w-xl">
          <h1 className="text-lg font-semibold text-white mb-6">
            {tab === 'account' ? 'Account' : 'Advanced'}
          </h1>
          {tab === 'account' && <AccountTab />}
          {tab === 'advanced' && <AdvancedTab />}
        </div>
      </main>
    </div>
  )
}
