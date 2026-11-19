/*
 * The integration's end of the daemon's mount link.
 *
 * An integration that stays connected to the daemon, such as a Windows sync
 * root provider, calls `mount` on a connection and keeps it open. The daemon
 * sends each question about the folder down that connection as a frame, and
 * takes the answer as a `mountAnswer` call naming the frame's request. The
 * daemon's end is `mountLink.ts` in the CLI.
 */
import { logger } from '@siastorage/logger'
import { connectToIpc, sendIpcCommand } from './ipc'

/** One question the daemon sends down the link. */
export type MountRequestFrame = {
  event: 'mount'
  /** Names this question in the `mountAnswer` that answers it. */
  request: string
  /**
   * `dehydrate` and `resend` are answered with a result for each of
   * `stackIds`. `list` names no files, and is answered with the stack id of
   * every file the folder holds whole.
   */
  verb: 'dehydrate' | 'resend' | 'list'
  stackIds: string[]
}

export type HeldMountLink = {
  /** Resolves when the connection ends, as it does when the daemon stops. */
  closed: Promise<void>
  close(): void
}

/**
 * Opens the link on the daemon serving `sockPath`, and answers each question
 * with what `answer` resolves to. Resolves once the daemon has the link. A
 * question `answer` rejects goes unanswered, and the daemon gives up on it
 * after its timeout.
 */
export async function holdMountLink(
  sockPath: string,
  answer: (verb: MountRequestFrame['verb'], stackIds: string[]) => Promise<unknown>,
): Promise<HeldMountLink> {
  const socket = await connectToIpc(sockPath)
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  const opened = crypto.randomUUID()
  await new Promise<void>((resolve, reject) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines.filter((l) => l.trim())) {
        const frame = JSON.parse(line) as Partial<MountRequestFrame> & {
          id?: string
          error?: string
        }
        // The daemon answers a `mount` it refused with an error.
        if (frame.id === opened) {
          if (frame.error) reject(new Error(frame.error))
          else resolve()
        }
        if (frame.event !== 'mount' || !frame.verb) continue
        answer(frame.verb, frame.stackIds ?? [])
          .then((results) =>
            sendIpcCommand(sockPath, 'mountAnswer', { args: [frame.request, results] }),
          )
          .catch((e) => logger.error('mountLink', 'answer_failed', { verb: frame.verb, error: e }))
      }
    })
    socket.once('error', reject)
    void closed.then(() => reject(new Error('The daemon closed the mount link')))
    socket.write(`${JSON.stringify({ id: opened, method: 'mount', params: {} })}\n`)
  }).catch((e) => {
    // A link the daemon refused is of no use, and left open it would keep
    // the caller's process alive.
    socket.destroy()
    throw e
  })
  return { closed, close: () => socket.destroy() }
}
