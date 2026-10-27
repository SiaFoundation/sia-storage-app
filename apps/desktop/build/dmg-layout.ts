/*
 * Positions and copy for the disk image window.
 *
 * The app sits on the left and Applications on the right, which is how current
 * Mac installers arrange the drag, and the sentence above them is the line
 * those installers use. Finder draws both icons and their names. The
 * background picture is only the sentence and the arrow. It covers the icon
 * view under the title bar, and a stored icon position is already the center
 * of that icon in the view, so the arrow uses the stored y directly.
 */

const installerWindow = { x: 200, y: 120, width: 660, height: 400 }

const installerTitleBar = 32

const installerIconSize = 128

// A 128-point Finder icon paints a smaller image than the cell it occupies.
export const installerIconInk = 102

export function installerLayout(appName: string) {
  const app = { x: 176, y: 181 }
  const applications = { x: 484, y: 181 }
  const ink = installerIconInk / 2
  const clearance = 18
  const head = 12
  return {
    window: installerWindow,
    titleBar: installerTitleBar,
    iconSize: installerIconSize,
    background: {
      width: installerWindow.width,
      height: installerWindow.height - installerTitleBar,
    },
    app,
    applications,
    caption: `Drag ${appName} to your Applications folder`,
    captionBaseline: app.y - ink - 36,
    arrow: {
      x1: app.x + ink + clearance,
      x2: applications.x - ink - clearance - head,
      y: app.y,
      bow: 22,
    },
  }
}
