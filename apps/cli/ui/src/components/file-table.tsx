import { Download, Braces } from 'lucide-react'
import type { DirectoryEntry, FileEntry } from '../lib/api'
import { formatBytes, formatRelativeDate } from '../lib/format'
import { Link } from './link'

type FileTableProps = {
  path: string
  directories: DirectoryEntry[]
  files: FileEntry[]
  downloadEnabled?: boolean
}

export function FileTable({ path, directories, files, downloadEnabled = true }: FileTableProps) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
            Name
          </th>
          <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
            Type
          </th>
          <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
            Size
          </th>
          <th className="text-left px-4 py-2 border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
            Modified
          </th>
          <th className="px-4 py-2 border-b border-gray-200" />
        </tr>
      </thead>
      <tbody>
        {directories.map((d) => (
          <tr key={d.path}>
            <td className="px-4 py-2 border-b border-gray-100">
              <Link href={`/${d.path}`} className="text-blue-600 hover:underline">
                {d.name}/
              </Link>
            </td>
            <td className="px-4 py-2 border-b border-gray-100 text-sm text-gray-400">folder</td>
            <td className="px-4 py-2 border-b border-gray-100 text-sm text-gray-500 font-mono">
              {d.fileCount.toLocaleString()} files
            </td>
            <td className="px-4 py-2 border-b border-gray-100" />
            <td className="px-4 py-2 border-b border-gray-100" />
          </tr>
        ))}
        {files.map((f) => {
          const href = path === '/' ? `/${f.name}` : `${path}/${f.name}`
          const typeBadge = f.type.split('/')[1] ?? f.type
          return (
            <tr key={f.name}>
              <td className="px-4 py-2 border-b border-gray-100">
                <Link href={href} className="text-blue-600 hover:underline">
                  {f.name}
                </Link>
              </td>
              <td className="px-4 py-2 border-b border-gray-100 text-sm text-gray-400">
                {typeBadge}
              </td>
              <td className="px-4 py-2 border-b border-gray-100 text-sm text-gray-500 font-mono">
                {formatBytes(f.size)}
              </td>
              <td className="px-4 py-2 border-b border-gray-100 text-sm text-gray-500 font-mono">
                {formatRelativeDate(f.updatedAt)}
              </td>
              <td className="px-4 py-2 border-b border-gray-100">
                <div className="flex gap-1 justify-end">
                  {downloadEnabled && (
                    <a
                      href={`${href}?dl`}
                      title="Download"
                      className="text-gray-300 hover:text-blue-600 transition-colors"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  <Link
                    href={`${href}?view=metadata`}
                    title="View metadata"
                    className="text-gray-300 hover:text-blue-600 transition-colors"
                  >
                    <Braces size={14} />
                  </Link>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
