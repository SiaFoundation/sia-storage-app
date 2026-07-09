import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Pressable, StyleSheet, Text } from 'react-native'
import { LibraryStatusSheet } from '../components/LibraryStatusSheet'
import { dismissStatusSheet } from '../lib/navigationRef'
import { ImportDetailScreen } from '../screens/ImportDetailScreen'
import { ImportsScreen } from '../screens/ImportsScreen'
import { UnavailableFilesScreen } from '../screens/UnavailableFilesScreen'
import { UploadsScreen } from '../screens/UploadsScreen'
import { palette } from '../styles/colors'
import { RootTabs } from './RootTabs'
import type { ImportsStackParamList, RootStackParamList } from './types'

const Root = createNativeStackNavigator<RootStackParamList>()
const Sheet = createNativeStackNavigator<ImportsStackParamList>()

// Android has no swipe-down-to-dismiss; the sheet needs an explicit exit.
function DoneButton() {
  return (
    // Padded rather than hitSlopped: iOS wraps custom header items in a glass
    // capsule sized to the view's box, and a text-sized box renders as a
    // cramped circle.
    <Pressable accessibilityRole="button" onPress={dismissStatusSheet} style={styles.doneButton}>
      <Text style={styles.done}>Done</Text>
    </Pressable>
  )
}

// The one activity surface, shared by every entry point: Status at the root,
// the imports flow pushed inside it. Deep entries (a folder banner, "View
// import") open mid-stack with Status beneath, so back always walks up to
// Status and dismissing returns to wherever the user was.
function StatusSheetModal() {
  return (
    <Sheet.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: palette.gray[50],
        headerRight: DoneButton,
      }}
    >
      <Sheet.Screen name="Status" component={LibraryStatusSheet} options={{ title: 'Status' }} />
      <Sheet.Screen name="Imports" component={ImportsScreen} options={{ title: 'Imports' }} />
      <Sheet.Screen
        name="ImportDetail"
        component={ImportDetailScreen}
        options={{ title: 'Import' }}
      />
      <Sheet.Screen
        name="Unavailable"
        component={UnavailableFilesScreen}
        options={{ title: 'Unavailable' }}
      />
      <Sheet.Screen name="Uploads" component={UploadsScreen} options={{ title: 'Uploads' }} />
    </Sheet.Navigator>
  )
}

export function RootStack() {
  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      <Root.Screen name="Tabs" component={RootTabs} />
      <Root.Group screenOptions={{ presentation: 'modal' }}>
        <Root.Screen name="StatusSheet" component={StatusSheetModal} />
      </Root.Group>
    </Root.Navigator>
  )
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: palette.gray[950],
  },
  doneButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  done: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
})
