const COLORS = ['#C3E500', '#76E6EB', '#36D955', '#E50AAE', '#FF7919']

type BlocksLoaderProps = {
  size?: number
  colorStart?: number
  label?: string
}

export function BlocksLoader({
  size = 16,
  colorStart = 0,
  label,
}: BlocksLoaderProps) {
  const colors = [0, 1, 2].map((i) => COLORS[(colorStart + i) % COLORS.length])

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative"
        style={{ width: size * 3, height: size }}
        role="progressbar"
        aria-label={label || 'Loading'}
      >
        {colors.map((color, i) => (
          <div
            key={i}
            className="absolute top-0"
            style={{
              left: i * size,
              width: size,
              height: size,
              backgroundColor: color,
              animation: `blocks-pulse 2600ms linear infinite`,
              animationDelay: `${(i * 2600) / 3}ms`,
              opacity: 0.25,
            }}
          />
        ))}
      </div>
      {label && <p className="text-neutral-400 text-sm">{label}</p>}
      <style>{`
        @keyframes blocks-pulse {
          0% { opacity: 1; }
          6.7% { opacity: 1; }
          40% { opacity: 0.25; }
          60% { opacity: 0.25; }
          93.3% { opacity: 1; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
