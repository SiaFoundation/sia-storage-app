import { View, Text, StyleSheet, Pressable } from 'react-native'
import { overlay, palette } from '../styles/colors'
import { useAppStatus } from '../hooks/useAppStatus'
import { openSheet } from '../stores/sheets'

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
          {appStatus.hint ? (
            <Text style={styles.statusPillText}>{appStatus.hint}</Text>
          ) : null}
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
    flexDirection: 'row',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: overlay.pill,
  },
  statusPillText: {
    color: palette.gray[50],
    fontSize: 10,
    fontWeight: '600',
  },
})
