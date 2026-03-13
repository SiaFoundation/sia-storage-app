type ContentLayoutProps = {
  children: React.ReactNode
  maxWidth?: string
}

export function ContentLayout({
  children,
  maxWidth = 'max-w-7xl',
}: ContentLayoutProps) {
  return <div className={`${maxWidth} mx-auto px-6 py-6`}>{children}</div>
}
