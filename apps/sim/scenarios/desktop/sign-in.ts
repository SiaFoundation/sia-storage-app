/** Steps the sign-in scenarios share. */
import type { DesktopUi } from '../../src/devices/desktop-ui'

/** The heading of the first screen, where the Mac asks to be connected. */
export const WELCOME = 'Private storage, right in Finder'

/** Whether the button with this text is there and can be clicked. */
export async function buttonEnabled(ui: DesktopUi, text: string): Promise<boolean> {
  const button = (await ui.describe()).find((el) => el.role === 'button' && el.text === text)
  return button !== undefined && button.disabled !== true
}
