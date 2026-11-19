import { REPEAT_SAVE_MAX_HOLD, REPEAT_SAVE_QUIET } from '../config'

type FileSaves = {
  /** When the file was last saved. */
  savedAt: number
  /** The version waiting to upload, if the last save was held. */
  held?: {
    versionId: string
    /** When the first save of this run of held saves was made, for the cap. */
    runStartedAt: number
    timer: ReturnType<typeof setTimeout>
  }
}

/**
 * Holds back the upload of a Finder save made soon after the previous save of
 * the same file. Apps such as TextEdit, Pages and editors with autosave write
 * a file over and over while someone works, and each write becomes a version
 * that the uploader packs within seconds, so a document edited for an hour
 * could upload hundreds of times. A held save stays out of the upload queue,
 * which lets the next save replace it while it is still unsent, and the save
 * handler then deletes it.
 *
 * A save within REPEAT_SAVE_QUIET of the file's previous save is held. It is
 * released to upload once REPEAT_SAVE_QUIET passes with no newer save, or
 * REPEAT_SAVE_MAX_HOLD after the first held save of the run, whichever comes
 * first, so a file saved nonstop still uploads that often. A newer save takes
 * the held one's place and keeps the run's start. Any other save is not held.
 *
 * Holds live only in memory. After a restart, or `clear()`, the uploader's
 * poll finds a held version, since it has a local copy and no object, and
 * uploads it at once.
 */
export class RepeatSaveHold {
  /** Recent saves, by the id Finder knows the file by. */
  private files = new Map<string, FileSaves>()

  /** `release` queues a held version to upload. */
  constructor(private release: (versionId: string) => void) {}

  /**
   * Records a save of `stackId` as `versionId`, and returns whether it is
   * held. A version not held is the caller's to queue.
   */
  save(stackId: string, versionId: string, now = Date.now()): boolean {
    this.forgetQuiet(now)
    const previous = this.files.get(stackId)
    if (!previous || now - previous.savedAt >= REPEAT_SAVE_QUIET) {
      if (previous?.held) this.end(previous)
      this.files.set(stackId, { savedAt: now })
      return false
    }
    const runStartedAt = previous.held?.runStartedAt ?? now
    if (previous.held) clearTimeout(previous.held.timer)
    const releaseAt = Math.min(now + REPEAT_SAVE_QUIET, runStartedAt + REPEAT_SAVE_MAX_HOLD)
    const file: FileSaves = { savedAt: now }
    file.held = {
      versionId,
      runStartedAt,
      timer: setTimeout(() => this.end(file), Math.max(0, releaseAt - now)),
    }
    this.files.set(stackId, file)
    return true
  }

  /** The versions held now. */
  heldIds(): string[] {
    const ids: string[] = []
    for (const file of this.files.values()) if (file.held) ids.push(file.held.versionId)
    return ids
  }

  /**
   * Releases at once any held version among `ids`, matched by the version or
   * by the file it belongs to.
   */
  releaseNow(ids: Iterable<string>): void {
    const wanted = new Set(ids)
    for (const [stackId, file] of this.files) {
      if (file.held && (wanted.has(stackId) || wanted.has(file.held.versionId))) this.end(file)
    }
  }

  /**
   * Stops holding `versionId` without releasing it, for a version the caller
   * takes out of the uploader for good. Returns whether it was held.
   */
  drop(versionId: string): boolean {
    for (const file of this.files.values()) {
      if (file.held?.versionId !== versionId) continue
      clearTimeout(file.held.timer)
      file.held = undefined
      return true
    }
    return false
  }

  /** Forgets every save and hold, releasing nothing. */
  clear(): void {
    for (const file of this.files.values()) if (file.held) clearTimeout(file.held.timer)
    this.files.clear()
  }

  private end(file: FileSaves): void {
    const held = file.held
    if (!held) return
    clearTimeout(held.timer)
    file.held = undefined
    this.release(held.versionId)
  }

  /** Drops files past the quiet period with nothing held, which no later save can extend. */
  private forgetQuiet(now: number): void {
    for (const [stackId, file] of this.files) {
      if (!file.held && now - file.savedAt >= REPEAT_SAVE_QUIET) this.files.delete(stackId)
    }
  }
}
