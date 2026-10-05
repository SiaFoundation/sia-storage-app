import { createShareRequests, type ShareRequestFrame } from '../../src/daemon/shareRequests'

function setup(opts: { subscribers: number; appPath?: string }) {
  const broadcast: ShareRequestFrame[] = []
  const opened: string[] = []
  const requests = createShareRequests({
    subscriberCount: () => opts.subscribers,
    broadcast: (frame) => broadcast.push(frame),
    appPath: opts.appPath,
    openApp: async (path) => {
      opened.push(path)
    },
  })
  return { requests, broadcast, opened }
}

describe('share requests from Finder', () => {
  it('go straight to an attached app', async () => {
    const { requests, broadcast, opened } = setup({ subscribers: 1 })

    await requests.request(['a', 'b'])

    expect(broadcast).toEqual([{ event: 'share', fileIds: ['a', 'b'] }])
    expect(opened).toEqual([])
  })

  it('open the app when none is attached, and reach it once it attaches', async () => {
    const { requests, broadcast, opened } = setup({ subscribers: 0, appPath: '/Apps/Sia.app' })

    await requests.request(['a'])
    const received: ShareRequestFrame[] = []
    requests.attached((frame) => received.push(frame))

    expect(opened).toEqual(['/Apps/Sia.app'])
    expect(broadcast).toEqual([])
    expect(received).toEqual([{ event: 'share', fileIds: ['a'] }])
  })

  it('reach only the first app to attach', async () => {
    const { requests } = setup({ subscribers: 0, appPath: '/Apps/Sia.app' })
    await requests.request(['a'])
    requests.attached(() => {})

    const later: ShareRequestFrame[] = []
    requests.attached((frame) => later.push(frame))

    expect(later).toEqual([])
  })

  it('fail with what to do when no app is attached and there is none to open', async () => {
    const { requests } = setup({ subscribers: 0 })

    await expect(requests.request(['a'])).rejects.toThrow(
      'Open Sia Storage to share files from Finder.',
    )
  })

  it('fail without naming the app when it cannot be opened, and hand nothing to a later app', async () => {
    const requests = createShareRequests({
      subscriberCount: () => 0,
      broadcast: () => {},
      appPath: '/Applications/Sia Storage.app',
      openApp: () => Promise.reject(new Error('open exited with 1')),
    })

    const failed = await requests.request(['a']).catch((e: Error) => e.message)
    expect(failed).toBe('Sia Storage could not be opened. Open it, then share again.')
    const later: ShareRequestFrame[] = []
    requests.attached((frame) => later.push(frame))
    expect(later).toEqual([])
  })
})
