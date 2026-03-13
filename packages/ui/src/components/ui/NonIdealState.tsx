type NonIdealStateProps = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function NonIdealState({
  icon,
  title,
  description,
  action,
}: NonIdealStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {icon && <div className="mb-3">{icon}</div>}
      <p className="text-neutral-100 font-extrabold text-lg pt-3 pb-1.5">
        {title}
      </p>
      {description && (
        <p className="text-neutral-400 text-sm text-center max-w-xs">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
