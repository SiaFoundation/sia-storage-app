import { galleryColumns } from './galleryColumns'

describe('galleryColumns', () => {
  it('keeps three columns on phones, including an iPhone Duo folded', () => {
    expect(galleryColumns(402)).toBe(3)
    expect(galleryColumns(440)).toBe(3)
    expect(galleryColumns(382)).toBe(3)
  })

  it('adds columns as the gallery widens, as on an unfolded iPhone Duo or an iPad', () => {
    expect(galleryColumns(669)).toBe(5)
    expect(galleryColumns(1024)).toBe(8)
  })

  it('never drops below three columns, even before the gallery has a width', () => {
    expect(galleryColumns(0)).toBe(3)
  })
})
