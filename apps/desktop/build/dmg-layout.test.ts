import { describe, expect, it } from 'bun:test'
import { installerIconInk, installerLayout } from './dmg-layout'

describe('the installer window', () => {
  it('tells you to drag the app into Applications', () => {
    expect(installerLayout('Sia Storage Beta').caption).toBe(
      'Drag Sia Storage Beta to your Applications folder',
    )
  })

  it('keeps the arrow in the gap between the two icons', () => {
    const layout = installerLayout('Sia Storage')
    const ink = installerIconInk / 2

    expect(layout.app.y).toBe(layout.applications.y)
    expect(layout.arrow.x1).toBeGreaterThan(layout.app.x + ink)
    expect(layout.arrow.x2).toBeLessThan(layout.applications.x - ink)
    expect(layout.arrow.y).toBeGreaterThan(layout.captionBaseline)
    expect(layout.arrow.y).toBeLessThan(layout.background.height)
    expect(layout.captionBaseline).toBeGreaterThan(24)
  })
})
