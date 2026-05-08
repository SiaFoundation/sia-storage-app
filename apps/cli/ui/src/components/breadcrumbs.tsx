import { Link } from './link'

export function Breadcrumbs({ path }: { path: string }) {
  if (path === '/') {
    return (
      <h1 className="text-lg font-normal text-gray-500">
        <Link href="/" className="text-blue-600 hover:underline">
          ~
        </Link>
      </h1>
    )
  }

  const parts = path.replace(/^\//, '').split('/')
  let href = ''

  return (
    <h1 className="text-lg font-normal text-gray-500">
      <Link href="/" className="text-blue-600 hover:underline">
        ~
      </Link>
      {parts.map((part, i) => {
        href += `/${part}`
        return (
          <span key={i}>
            {' / '}
            <Link href={href} className="text-blue-600 hover:underline">
              {part}
            </Link>
          </span>
        )
      })}
    </h1>
  )
}
