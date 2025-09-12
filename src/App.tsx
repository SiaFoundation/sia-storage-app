import React from 'react'
import { StyleSheet, Platform, StatusBar } from 'react-native'
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ToastProvider } from './lib/toastContext'
import { type FeedStackParamList } from './navigation/types'
import HomeScreen from './screens/HomeScreen'
import FileDetailScreen from './screens/FileDetailScreen'
import SettingsHomeScreen, {
  type SettingsStackParamList,
} from './screens/SettingsHomeScreen'
import HostsScreen from './screens/HostsScreen'
import HostDetailScreen from './screens/HostDetailScreen'
import IndexerScreen from './screens/IndexerScreen'
import { HomeIcon, SettingsIcon, TerminalIcon } from 'lucide-react-native'
import LogScreen from './screens/LogScreen'
import { SettingsProvider, useSettings } from './lib/settingsContext'
import OnboardingScreen from './screens/OnboardingScreen'
import { FilesProvider } from './lib/filesContext'
import ConnectionBanner from './components/ConnectionBanner'
import * as SplashScreen from 'expo-splash-screen'
import ImportFileScreen from './screens/ImportFileScreen'
import useLinkedURL from './hooks/useLinkedURL'

SplashScreen.preventAutoHideAsync()

const FeedStack = createNativeStackNavigator<FeedStackParamList>()
type RootTabParamList = {
  FeedTab: undefined
  SettingsTab: undefined
  LogsTab: undefined
}
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>()
const Tab = createBottomTabNavigator<RootTabParamList>()
const AuthStack = createNativeStackNavigator()

function HomeTabIcon({ color, size }: { color: string; size: number }) {
  return <HomeIcon color={color} size={size} />
}

function SettingsTabIcon({ color, size }: { color: string; size: number }) {
  return <SettingsIcon color={color} size={size} />
}

function LogsTabIcon({ color, size }: { color: string; size: number }) {
  return <TerminalIcon color={color} size={size} />
}

function FeedStackNavigator() {
  return (
    <FeedStack.Navigator>
      <FeedStack.Screen name="Home" options={{ headerShown: false }}>
        {() => <HomeScreen />}
      </FeedStack.Screen>
      <FeedStack.Screen
        name="FileDetail"
        component={FileDetailScreen}
        options={{ title: 'Media' }}
      />
      <FeedStack.Screen
        name="ImportFile"
        component={ImportFileScreen}
        options={{ title: 'Import File' }}
      />
    </FeedStack.Navigator>
  )
}

function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator>
      <SettingsStack.Screen
        name="SettingsHome"
        component={SettingsHomeScreen}
        options={{ title: 'Settings' }}
      />
      <SettingsStack.Screen
        name="Hosts"
        component={HostsScreen}
        options={{ title: 'Hosts' }}
      />
      <SettingsStack.Screen
        name="HostDetail"
        component={HostDetailScreen}
        options={{ title: 'Host' }}
      />
      <SettingsStack.Screen
        name="Indexer"
        component={IndexerScreen}
        options={{ title: 'Indexer' }}
      />
    </SettingsStack.Navigator>
  )
}

function AuthStackNavigator() {
  return (
    <AuthStack.Navigator>
      <AuthStack.Screen name="Connect" options={{ headerShown: false }}>
        {() => <OnboardingScreen />}
      </AuthStack.Screen>
    </AuthStack.Navigator>
  )
}

function RootNavigator() {
  const { isOnboarding } = useSettings()
  if (isOnboarding) return <AuthStackNavigator />
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: 49,
          paddingBottom: 4,
          paddingTop: 4,
        },
        tabBarLabelStyle: { marginBottom: 0 },
        tabBarItemStyle: { paddingVertical: 0 },
      }}
    >
      <Tab.Screen
        name="FeedTab"
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: HomeTabIcon,
        }}
      >
        {() => <FeedStackNavigator />}
      </Tab.Screen>
      <Tab.Screen
        name="SettingsTab"
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: SettingsTabIcon,
        }}
      >
        {() => <SettingsStackNavigator />}
      </Tab.Screen>
      <Tab.Screen
        name="LogsTab"
        options={{
          tabBarLabel: 'Logs',
          tabBarIcon: LogsTabIcon,
        }}
      >
        {() => <LogScreen />}
      </Tab.Screen>
    </Tab.Navigator>
  )
}

export default function AppComponent() {
  const navigationRef = useNavigationContainerRef<any>()

  useLinkedURL((incomingUrl) => {
    try {
      const url = new URL(incomingUrl)
      const path = url.pathname.replace(/^\//, '')
      const host = url.host
      if (host === 'new-file' || path === 'new-file') {
        const shareUrl = url.searchParams.get('shareUrl') ?? undefined
        if (shareUrl && navigationRef.isReady()) {
          navigationRef.navigate('FeedTab', {
            screen: 'ImportFile',
            params: { shareUrl },
          })
        }
      }
    } catch (_) {
      // Ignore invalid URLs.
    }
  })

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar
          barStyle={Platform.select({
            ios: 'dark-content',
            android: 'dark-content',
            default: 'dark-content',
          })}
        />
        <SettingsProvider>
          <FilesProvider>
            <ToastProvider>
              <NavigationContainer ref={navigationRef}>
                <ConnectionBanner />
                <RootNavigator />
              </NavigationContainer>
            </ToastProvider>
          </FilesProvider>
        </SettingsProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
})
