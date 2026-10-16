/** The narrowest a gallery tile gets before the gallery drops a column. */
const MIN_TILE_WIDTH = 128

/**
 * Three columns on any phone, and more where the gallery is wider, such as on
 * an iPad or an unfolded iPhone Duo.
 */
export function galleryColumns(width: number): number {
  return Math.max(3, Math.floor(width / MIN_TILE_WIDTH))
}
