import { useNavigation } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Pressable, StyleSheet, Text } from 'react-native'
import { ImportDetailScreen } from '../screens/ImportDetailScreen'
import { ImportsScreen } from '../screens/ImportsScreen'
import { palette } from '../styles/colors'
import { RootTabs } from './RootTabs'
import type { ImportsStackParamList, RootStackParamList } from './types'

const Root = createNativeStackNavigator<RootStackParamList>()
const Imports = createNativeStackNavigator<ImportsStackParamList>()

// Android has no swipe-down-to-dismiss; the modal needs an explicit exit.
function DoneButton() {
  const navigation = useNavigation()
  return (
    // goBack from the modal's root screen can't pop the inner stack, so the
    // action bubbles up and dismisses the modal itself.
    <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} hitSlop={8}>
      <Text style={styles.done}>Done</Text>
    </Pressable>
  )
}

// One modal flow shared by every entry point: the detail screen pushes
// horizontally inside the modal, and dismissing returns to wherever the
// user was.
function ImportsModal() {
  return (
    <Imports.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: palette.gray[50],
      }}
    >
      <Imports.Screen
        name="Imports"
        component={ImportsScreen}
        options={{ title: 'Imports', headerRight: DoneButton }}
      />
      <Imports.Screen
        name="ImportDetail"
        component={ImportDetailScreen}
        options={{ title: 'Import' }}
      />
    </Imports.Navigator>
  )
}

export function RootStack() {
  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      <Root.Screen name="Tabs" component={RootTabs} />
      <Root.Group screenOptions={{ presentation: 'modal' }}>
        <Root.Screen name="ImportsModal" component={ImportsModal} />
      </Root.Group>
    </Root.Navigator>
  )
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: palette.gray[950],
  },
  done: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
})
