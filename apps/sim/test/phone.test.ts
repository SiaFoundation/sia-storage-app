import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { PhoneDevice } from '../src/devices/phone'
import { Session } from '../src/session'

// Adding photos and handing back call four of a platform's methods and its
// `stop`, so the double defines those and leaves the rest of what PhoneDevice
// declares abstract undefined, which this type lets it do.
const Phone = PhoneDevice as unknown as new (
  name: string,
  session: Session,
) => Pick<PhoneDevice, 'addPhotos' | 'dispose'>

/** A phone with no simulator behind it, which records what was done to its photo library and its lease. */
class FakePhone extends Phone {
  readonly calls: string[] = []
  failing: 'put' | 'remove' | null = null

  protected async putPhotos(paths: string[]): Promise<void> {
    if (this.failing === 'put') throw new Error('the run was killed here')
    this.calls.push(`put ${paths.join(' ')}`)
  }
  protected async removePhotos(target: string, names: string[]): Promise<void> {
    this.calls.push(`remove ${names.join(' ')} from ${target}`)
    if (this.failing === 'remove') throw new Error('the simulator did not shut down')
  }
  protected release(target: string): void {
    this.calls.push(`release ${target}`)
  }
  protected async discard(target: string): Promise<void> {
    this.calls.push(`discard ${target}`)
  }
  async stop(): Promise<void> {}
}

describe('a phone and the photos it adds to its pooled device', () => {
  const sessions: Session[] = []
  afterAll(() => {
    for (const session of sessions) session.remove()
  })

  async function phoneOn(target: string): Promise<{ phone: FakePhone; session: Session }> {
    const session = Session.create(`unit-photos-${process.pid}-${sessions.length}`, {
      fastTimers: true,
    })
    sessions.push(session)
    await session.update((s) => {
      s.devices.phone = { kind: 'ios', dir: session.deviceDir('phone'), target }
    })
    return { phone: new FakePhone('phone', session), session }
  }

  test('handing the phone back takes its photos out before the device is released', async () => {
    const { phone, session } = await phoneOn('sim-1')
    await phone.addPhotos(['/work/one.png', '/work/two.png'])
    expect(session.state.devices.phone.photos).toEqual(['one.png', 'two.png'])

    await phone.dispose()
    expect(phone.calls).toEqual([
      'put /work/one.png /work/two.png',
      'remove one.png two.png from sim-1',
      'release sim-1',
    ])
    expect(session.state.devices.phone.photos).toBeUndefined()
    expect(session.state.devices.phone.target).toBeUndefined()
  })

  test('a phone that added no photos is released with its library untouched', async () => {
    const { phone } = await phoneOn('sim-2')
    await phone.dispose()
    expect(phone.calls).toEqual(['release sim-2'])
  })

  test('photos are recorded before they are added, so a run killed while adding still leaves their names', async () => {
    const { phone, session } = await phoneOn('sim-3')
    phone.failing = 'put'
    await expect(phone.addPhotos(['/work/one.png'])).rejects.toThrow('the run was killed here')
    expect(Session.load(session.name)?.state.devices.phone.photos).toEqual(['one.png'])
  })

  test('a device whose photos could not be removed leaves the pool instead of going back to it', async () => {
    const { phone, session } = await phoneOn('sim-4')
    await phone.addPhotos(['/work/one.png'])
    phone.failing = 'remove'
    const logged = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await phone.dispose()
      expect(logged).toHaveBeenCalledTimes(1)
    } finally {
      logged.mockRestore()
    }
    expect(phone.calls).toEqual(['put /work/one.png', 'remove one.png from sim-4', 'discard sim-4'])
    expect(session.state.devices.phone.target).toBeUndefined()
  })
})
