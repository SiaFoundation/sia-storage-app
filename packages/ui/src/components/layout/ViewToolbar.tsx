import { navigate } from '../../lib/router'

type Breadcrumb = {
  label: string
  path?: string
  icon?: React.ReactNode
}

type ViewToolbarProps = {
  title?: string
  backPath?: string
  backLabel?: string
  breadcrumbs?: Breadcrumb[]
  count?: number
  countLabel?: string
  children?: React.ReactNode
}

export function ViewToolbar({
  title,
  backPath,
  backLabel = 'Back',
  breadcrumbs,
  count,
  countLabel,
  children,
}: ViewToolbarProps) {
  return (
    <div className="sticky top-12 z-10 bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-6 h-11 flex items-center gap-2">
        {breadcrumbs ? (
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1
              return (
                <span
                  key={crumb.label}
                  className="flex items-center gap-1.5 min-w-0"
                >
                  {i > 0 && (
                    <span className="text-neutral-600 flex-shrink-0">/</span>
                  )}
                  {crumb.icon && (
                    <span className="flex-shrink-0">{crumb.icon}</span>
                  )}
                  {isLast ? (
                    <span className="text-white font-medium truncate">
                      {crumb.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => crumb.path && navigate(crumb.path)}
                      className="text-neutral-400 hover:text-neutral-200 transition-colors flex-shrink-0"
                    >
                      {crumb.label}
                    </button>
                  )}
                </span>
              )
            })}
          </nav>
        ) : (
          <>
            {backPath && (
              <button
                type="button"
                onClick={() => navigate(backPath)}
                className="text-neutral-400 hover:text-neutral-200 flex items-center gap-1 text-sm transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <title>Back</title>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                {backLabel}
              </button>
            )}

            {title && (
              <span className="text-sm text-white font-medium truncate">
                {title}
              </span>
            )}
          </>
        )}

        <div className="flex-1" />

        {count !== undefined && (
          <span className="text-xs text-neutral-500">
            {count.toLocaleString()}{' '}
            {countLabel ?? `file${count !== 1 ? 's' : ''}`}
          </span>
        )}

        {children}
      </div>
    </div>
  )
}
