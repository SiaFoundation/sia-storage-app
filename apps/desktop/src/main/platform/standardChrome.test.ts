import { describe, expect, it, mock } from 'bun:test'

/*
 * Which icon files the Windows and Linux chrome hands Electron, which loads
 * .ico files only on Windows. The package's test script runs this file in a
 * bun process of its own, for the reason `updates.test.ts` gives.
 */

const loaded: string[] = []
mock.module('electron', () => ({
  nativeImage: {
    createFromPath: (path: string) => {
      loaded.push(path)
      return {}
    },
  },
  nativeTheme: { shouldUseDarkColors: false },
}))
mock.module('../paths', () => ({ buildVariant: () => 'beta' }))

const { standardChrome } = await import('./standardChrome')

function on(platform: NodeJS.Platform, run: () => void): void {
  const real = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    run()
  } finally {
    Object.defineProperty(process, 'platform', { value: real })
  }
}

describe('the Windows and Linux icons', () => {
  it("are the build's .ico files on Windows", () => {
    on('win32', () => {
      expect(standardChrome.mainWindow().icon).toEndWith('/assets/icons/windows-beta.ico')
      expect(standardChrome.popover().icon).toEndWith('/assets/icons/windows-beta.ico')
      standardChrome.trayImage()
      expect(loaded.at(-1)).toEndWith('/assets/icons/windows-tray-beta.ico')
    })
  })

  it('leave the windows no icon and give the tray the PNG on Linux', () => {
    on('linux', () => {
      expect(standardChrome.mainWindow().icon).toBeUndefined()
      expect(standardChrome.popover().icon).toBeUndefined()
      standardChrome.trayImage()
      expect(loaded.at(-1)).toEndWith('/assets/tray-Template.png')
    })
  })
})
