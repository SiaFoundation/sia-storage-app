import { CommonActions, createNavigationContainerRef } from '@react-navigation/native'
import type { RootStackParamList } from '../stacks/types'

/**
 * App-wide navigation ref. Lets surfaces mounted outside the
 * `NavigationContainer` drive navigation. Pass it to
 * `<NavigationContainer ref={...}>` in Root.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>()

/**
 * Dismisses the status sheet from any screen inside it. The GO_BACK is
 * targeted at the root stack's state: an untargeted goBack is handled by the
 * focused inner navigator first and would pop within the sheet instead.
 */
export function dismissStatusSheet(): void {
  if (!navigationRef.isReady()) return
  navigationRef.dispatch({
    ...CommonActions.goBack(),
    target: navigationRef.getRootState().key,
  })
}

/** Opens the status sheet on its Status root, if navigation is ready. */
export function navigateToStatusSheet(): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('StatusSheet', { screen: 'Status' })
}

/**
 * Opens the status sheet directly on the imports list. `initial: false`
 * mounts Status beneath, so back walks up to it instead of dismissing.
 */
export function navigateToImports(): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('StatusSheet', { screen: 'Imports', initial: false })
}

/**
 * Opens a folder in the library tab. When called from inside the status
 * sheet, the sheet is dismissed first: a single navigate would reach the
 * same state, but its pop and push animate simultaneously and read as a
 * second sheet sliding over the first.
 */
export function navigateToDirectory(dir: { id: string; name: string; path: string }): void {
  if (!navigationRef.isReady()) return
  const root = navigationRef.getRootState()
  if (root.routes[root.index]?.name === 'StatusSheet') dismissStatusSheet()
  navigationRef.navigate('Tabs', {
    screen: 'MainTab',
    params: {
      screen: 'DirectoryScreen',
      params: { directoryId: dir.id, directoryName: dir.name, directoryPath: dir.path },
    },
  })
}
