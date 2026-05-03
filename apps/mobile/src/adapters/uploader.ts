import type { UploaderAdapters } from '@siastorage/core/app'
import { db } from '../db'
import { createFileReader } from '../lib/fileReader'

export function createUploaderAdapters(): UploaderAdapters {
  return {
    createFileReader: (uri) => createFileReader(uri),
    progressScheduler: (cb) => requestAnimationFrame(cb),
    // Surface the DB gate so saveBatchObjects can wait for resume
    // before issuing finalize reads/writes (otherwise pin progress
    // is dropped on the floor when finalize fires post-suspend).
    db: db(),
  }
}
