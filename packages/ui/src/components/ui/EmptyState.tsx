import { NonIdealState } from './NonIdealState'

type EmptyStateProps = {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <NonIdealState
      icon={
        <img
          src="/image-stack.png"
          alt=""
          className="w-[140px] h-[140px] opacity-60"
        />
      }
      title={title}
      description={description}
      action={action}
    />
  )
}
