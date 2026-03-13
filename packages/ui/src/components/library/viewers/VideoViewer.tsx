export function VideoViewer({ url }: { url: string }) {
  return (
    <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
      <video src={url} controls className="max-w-full max-h-full rounded-lg">
        <track kind="captions" />
      </video>
    </div>
  )
}
