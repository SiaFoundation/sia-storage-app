import React, { StrictMode, useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ConnectScreen from './ConnectScreen'
import useLinkedURL from './hooks/useLinkedURL'
import LoadingScreen from './LoadingScreen'
import FileScreen from './FileScreen'
import { initFileDB } from './functions/fileDB'

// Setup
initFileDB()

export default function App() {
  const [appStatus, setAppStatus] = useState<'loading' | 'needAuth' | 'ready'>(
    'loading'
  )
  const [indexDKey, setIndexDKey] = useState<string>()

  // Sets our key, I suppose, to further interface with
  // indexd
  useLinkedURL((url) => {
    if (url.includes('siastorage://')) {
      console.log('from useLinkedURL', url)
      setIndexDKey('some-key-that-works')
      setAppStatus('ready')
    }
  })

  useEffect(() => {
    // Simulate actual network traffic, getting a 400
    // level error, ending in needing auth.
    const fakeLoading = setTimeout(() => {
      setAppStatus('needAuth')
    }, 3000)
    return () => clearTimeout(fakeLoading)
  }, [])

  return (
    <StrictMode>
      <SafeAreaView style={styles.container}>
        {appStatus === 'loading' && <LoadingScreen />}
        {appStatus === 'needAuth' && (
          <ConnectScreen
            bypassAuth={() => {
              setIndexDKey('some-key-that-works')
              setAppStatus('ready')
            }}
          />
        )}
        {appStatus === 'ready' && <FileScreen />}
      </SafeAreaView>
    </StrictMode>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#517891', paddingTop: 0 },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f2937',
    backgroundColor: '#0b1220',
  },
  tabButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  tabLabel: { color: '#9da7b3', fontWeight: '700' },
  tabLabelActive: { color: '#0ea5e9' },
})
