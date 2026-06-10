import { thumbnailableTypesFor } from './thumbnail'

// Orientation and sizing now live in the native thumbnailer module, which can't
// run under jest — they're verified on-device with EXIF fixtures (orientations
// 1-8, plus a rotated video). This file covers the one piece of pure JS logic.
describe('thumbnailableTypesFor — per-platform decodable types', () => {
  it('offers DNG and Apple ProRAW only on iOS (Android BitmapFactory has no RAW)', () => {
    const raw = ['image/dng', 'image/x-adobe-dng', 'image/x-apple-proraw']
    expect(thumbnailableTypesFor('ios')).toEqual(expect.arrayContaining(raw))
    for (const type of raw) {
      expect(thumbnailableTypesFor('android')).not.toContain(type)
    }
  })

  it('offers the shared image + video types on both platforms', () => {
    for (const platform of ['ios', 'android'] as const) {
      const types = thumbnailableTypesFor(platform)
      expect(types).toEqual(expect.arrayContaining(['image/jpeg', 'image/heic', 'video/mp4']))
    }
  })
})
