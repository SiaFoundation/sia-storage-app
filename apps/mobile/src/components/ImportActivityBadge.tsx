import { CameraIcon, ClockIcon, CloudUploadIcon, TriangleAlertIcon } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import type { ImportActivity } from '../lib/importLabels'
import { activityBadgeLabel, activityColor, activityDetailLabel } from '../lib/importLabels'
import { palette } from '../styles/colors'
import { SpinnerIcon } from './SpinnerIcon'

/**
 * The in-flight state badge for an import: a spinner only when bytes are
 * actually moving, otherwise the wait state's icon and word. `variant`
 * picks the compact list word ("Waiting") or the specific detail label
 * ("Waiting on uploads").
 */
export function ImportActivityBadge({
  activity,
  variant,
}: {
  activity: ImportActivity
  variant: 'list' | 'detail'
}) {
  // Null means plain queued; it reads as importing rather than inventing a state.
  const a = activity ?? 'importing'
  const color = activityColor(a)
  const label = variant === 'list' ? activityBadgeLabel(a) : activityDetailLabel(a)
  return (
    <View style={styles.badge}>
      {a === 'importing' ? (
        <SpinnerIcon color={palette.blue[400]} size={12} />
      ) : a === 'idle-open' ? (
        <CameraIcon color={color} size={12} />
      ) : a === 'needs-space' ? (
        <TriangleAlertIcon color={color} size={12} />
      ) : a === 'retry-wait' ? (
        <ClockIcon color={color} size={12} />
      ) : (
        <CloudUploadIcon color={color} size={12} />
      )}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
})
