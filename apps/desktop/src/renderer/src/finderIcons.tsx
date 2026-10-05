/*
 * Finder's item icons, drawn small: the blue folder and the plain document.
 * Used wherever the app names files the way Finder shows them.
 */

export const FOLDER_PATH =
  'M2 5.2A1.6 1.6 0 0 1 3.6 3.6h3l1.5 1.6h6.3A1.6 1.6 0 0 1 16 6.8v6.6a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 13.4z'

export function FinderItemIcon({ folder, size = 17 }: { folder: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {folder ? (
        <>
          <path d={FOLDER_PATH} fill="#3d9bf3" />
          <path d="M2 7.2h14v6.2a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 13.4z" fill="#62b3ff" />
        </>
      ) : (
        <path
          d="M4.6 2.2h5.6l3.2 3.2v10.4H4.6zM10.2 2.2v3.2h3.2"
          fill="#f2f2f4"
          stroke="rgba(0,0,0,0.28)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
