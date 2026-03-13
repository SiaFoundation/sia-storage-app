export function AudioViewer({ url, name }: { url: string; name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
      <div className="w-full max-w-md bg-neutral-900 rounded-2xl p-8 text-center">
        <svg
          className="w-16 h-16 mx-auto mb-4 text-neutral-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <title>Audio</title>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <p className="text-sm text-neutral-300 mb-6 truncate">{name}</p>
        <audio src={url} controls className="w-full">
          <track kind="captions" />
        </audio>
      </div>
    </div>
  )
}
