import { createNavigationContainerRef } from '@react-navigation/native'
import type { RootStackParamList } from '../stacks/types'

/**
 * App-wide navigation ref. Lets surfaces mounted outside the
 * `NavigationContainer` drive navigation. Pass it to
 * `<NavigationContainer ref={...}>` in Root.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>()

/** Opens the imports modal on the list, if navigation is ready. */
export function navigateToImports(): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('ImportsModal', { screen: 'Imports' })
}
