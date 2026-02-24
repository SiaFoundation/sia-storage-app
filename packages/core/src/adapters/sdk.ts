export interface ObjectsCursor {
  id: string
  after: Date
}

export interface PinnedObjectRef {
  metadata(): ArrayBuffer
  updateMetadata(metadata: ArrayBuffer): void
  size(): bigint
}

export interface ObjectEvent {
  id: string
  object?: PinnedObjectRef
  deleted?: boolean
  updatedAt: Date
}

export interface SdkAdapter {
  objectEvents(
    cursor: ObjectsCursor | undefined,
    limit: number,
  ): Promise<ObjectEvent[]>
  updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void>
  download(pinnedObject: PinnedObjectRef): Promise<Uint8Array>
}
