export type PinnedSector = {
  root: string
  hostKey: string
}

export type Slab = {
  encryptionKey: ArrayBuffer
  minShards: number
  sectors: Array<PinnedSector>
  offset: number
  length: number
}
