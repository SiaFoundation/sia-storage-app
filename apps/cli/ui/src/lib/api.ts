export type DirectoryEntry = {
  name: string
  path: string
  fileCount: number
  subdirectoryCount: number
}

export type FileEntry = {
  name: string
  type: string
  size: number
  updatedAt: number
}

export type DirectoryResponse = {
  path: string
  downloadEnabled: boolean
  directories: DirectoryEntry[]
  files: FileEntry[]
}

export type FileResponse = {
  error?: string
}

export type ShareMetadata = Record<string, unknown>

export async function fetchPath(path: string): Promise<
  | {
      type: 'directory'
      data: DirectoryResponse
    }
  | {
      type: 'file'
      data: FileEntry
    }
  | {
      type: 'error'
      status: number
      message: string
    }
> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }))
    return { type: 'error', status: res.status, message: body.error ?? 'Unknown error' }
  }

  const data = await res.json()

  if ('directories' in data || 'files' in data) {
    return { type: 'directory', data: data as DirectoryResponse }
  }

  return { type: 'file', data: data as FileEntry }
}

export async function fetchMetadata(path: string): Promise<ShareMetadata | null> {
  const res = await fetch(`${path}?share`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null
  return res.json()
}
