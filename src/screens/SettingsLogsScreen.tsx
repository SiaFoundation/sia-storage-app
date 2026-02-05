import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ArrowDownIcon } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LogView } from '../components/LogView'
import { SettingsFullLayout } from '../components/SettingsLayout'
import { SettingsLogsControlBar } from '../components/SettingsLogsControlBar'
import { logsSwr, useHasNewLogs } from '../hooks/useLogs'
import { useMenuHeader } from '../hooks/useMenuHeader'
import type { MenuStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'

type Props = NativeStackScreenProps<MenuStackParamList, 'Logs'>

export function SettingsLogsScreen({ route, navigation }: Props) {
  useMenuHeader()
  const [displayedCount, setDisplayedCount] = useState(0)
  const [isFollowing, setIsFollowing] = useState(true)
  const hasNewLogs = useHasNewLogs(displayedCount)

  useEffect(() => {
    if (isFollowing && hasNewLogs) {
      logsSwr.triggerChange()
    }
  }, [isFollowing, hasNewLogs])

  const handleScrollAwayFromBottom = useCallback(() => {
    setIsFollowing(false)
  }, [])

  const handleShowNewLogs = () => {
    setIsFollowing(true)
    logsSwr.triggerChange()
  }

  return (
    <SettingsFullLayout>
      <LogView
        isFollowing={isFollowing}
        onLogCountChange={setDisplayedCount}
        onScrollAwayFromBottom={handleScrollAwayFromBottom}
      />
      {!isFollowing && hasNewLogs && (
        <View style={styles.floatingButtonContainer}>
          <Pressable style={styles.floatingButton} onPress={handleShowNewLogs}>
            <ArrowDownIcon size={16} color={palette.gray[50]} />
            <Text style={styles.floatingButtonText}>New logs</Text>
          </Pressable>
        </View>
      )}
      <SettingsLogsControlBar navigation={navigation} route={route} />
    </SettingsFullLayout>
  )
}

const styles = StyleSheet.create({
  floatingButtonContainer: {
    position: 'absolute',
    bottom: 95,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  floatingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: palette.blue[500],
    borderRadius: 20,
  },
  floatingButtonText: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
  },
})
