import { BlocksLoader } from '../ui/BlocksLoader'

export function LoadingScreen({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <BlocksLoader label={message || 'Initializing...'} />
    </div>
  )
}
