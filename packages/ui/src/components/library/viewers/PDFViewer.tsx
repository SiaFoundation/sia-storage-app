export function PDFViewer({ url, name }: { url: string; name: string }) {
  return (
    <div className="flex-1 overflow-hidden p-4">
      <iframe
        src={url}
        title={name}
        className="w-full h-full rounded-lg bg-white"
      />
    </div>
  )
}
