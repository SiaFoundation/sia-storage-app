import { Pressable, StyleSheet, View } from 'react-native'
import { useAppStatus } from '../hooks/useAppStatus'
import { openSheet } from '../stores/sheets'
import { overlay } from '../styles/colors'

export function LibraryAppStatusIcon() {
  const appStatus = useAppStatus()
  return (
    appStatus.visible && (
      <View style={styles.statusPillContainer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => openSheet('libraryStatus')}
          style={styles.statusPill}
        >
          {appStatus.icon}
        </Pressable>
      </View>
    )
  )
}

const styles = StyleSheet.create({
  statusPillContainer: {
    position: 'relative',
  },
  statusPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: overlay.pill,
  },
})
