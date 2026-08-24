import type { AppService } from '../app/service'
import { retypeFile } from './retypeFile'

function mockApp(over?: { renameThrows?: Error }) {
  const update = jest.fn(async () => {})
  const renameToType = jest.fn(async () => {
    if (over?.renameThrows) throw over.renameThrows
    return { uri: 'file://new' }
  })
  const uri = jest.fn(() => 'file://same')
  const app = { files: { update }, fs: { renameToType, uri } } as unknown as AppService
  return { app, update, renameToType, uri }
}

describe('retypeFile', () => {
  it('writes the type and moves the bytes to match it', async () => {
    const m = mockApp()
    await expect(retypeFile(m.app, 'f1', 'image/x-canon-cr3', 'image/jpeg')).resolves.toBe(
      'file://new',
    )
    expect(m.update).toHaveBeenCalledWith(
      { id: 'f1', type: 'image/jpeg' },
      { updatedAt: 'preserve' },
    )
    expect(m.renameToType).toHaveBeenCalledWith(
      { id: 'f1', type: 'image/x-canon-cr3' },
      'image/jpeg',
    )
  })

  it('rolls the type back when the bytes cannot be moved', async () => {
    // A row left on the new type names an extension nothing sits at.
    const m = mockApp({ renameThrows: new Error('cross-device link') })
    await expect(retypeFile(m.app, 'f1', 'image/x-canon-cr3', 'image/jpeg')).rejects.toThrow(
      'cross-device link',
    )
    expect(m.update).toHaveBeenLastCalledWith(
      { id: 'f1', type: 'image/x-canon-cr3' },
      { updatedAt: 'preserve' },
    )
  })

  it('skips the move for types that share an extension', async () => {
    // Both store as `.dng`, so the bytes are already in place.
    const m = mockApp()
    await expect(retypeFile(m.app, 'f1', 'image/dng', 'image/x-adobe-dng')).resolves.toBe(
      'file://same',
    )
    expect(m.update).toHaveBeenCalledWith(
      { id: 'f1', type: 'image/x-adobe-dng' },
      { updatedAt: 'preserve' },
    )
    expect(m.renameToType).not.toHaveBeenCalled()
  })
})
