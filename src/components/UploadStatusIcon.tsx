import {
  View,
  StyleSheet,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
} from 'react-native'
import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudDownloadIcon,
} from 'lucide-react-native'
import { FileStatus } from '../lib/file'
import { SpinnerIcon } from './SpinnerIcon'
import { useEffect, useMemo, useRef, useState } from 'react'

export function UploadStatusIcon({
  status,
  size = 16,
  interactive = false,
}: {
  status: FileStatus
  size?: number
  interactive?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const textOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (
      Platform.OS === 'android' &&
      UIManager.setLayoutAnimationEnabledExperimental
    ) {
      try {
        UIManager.setLayoutAnimationEnabledExperimental(true)
      } catch {}
    }
  }, [])

  const pillColor = status.isErrored ? '#c83532' : '#24292f'
  const iconColor = '#ffffff'
  const textColor = '#ffffff'

  const label = useMemo(() => {
    if (status.isErrored) return status.errorText || 'Error'
    if (status.isUploading) return 'Uploading'
    if (status.isDownloading) return 'Downloading'
    if (status.isUploaded && status.isDownloaded)
      return 'File on network and device'
    if (status.isUploaded && !status.isDownloaded) return 'File only on network'
    if (!status.isUploaded && status.isDownloaded) return 'File only on device'
    return ''
  }, [status])

  const el = (
    <View
      style={[
        styles.badge,
        expanded ? styles.badgeExpanded : null,
        {
          backgroundColor: pillColor,
          borderColor: pillColor,
        },
      ]}
    >
      {expanded && label ? (
        <Animated.Text
          style={[styles.pillText, { color: textColor, opacity: textOpacity }]}
          numberOfLines={1}
        >
          {label}
        </Animated.Text>
      ) : null}
      {status.isErrored ? (
        <CloudAlertIcon color={iconColor} size={size} />
      ) : status.isUploading ? (
        <SpinnerIcon size={size} />
      ) : status.isUploaded ? (
        status.isDownloaded ? (
          <CloudCheckIcon color={iconColor} size={size} />
        ) : (
          <CloudDownloadIcon color={iconColor} size={size} />
        )
      ) : (
        <CloudAlertIcon color={iconColor} size={size} />
      )}
    </View>
  )

  if (!interactive) {
    return el
  }

  return (
    <Pressable
      onPress={() => {
        const EXPAND_MS = 80
        const COLLAPSE_MS = 80
        const HALF = 40
        if (!expanded) {
          // Snap open; text fades in during second half.
          textOpacity.setValue(0)
          LayoutAnimation.configureNext(
            LayoutAnimation.create(EXPAND_MS, 'easeInEaseOut', 'opacity') as any
          )
          setExpanded(true)
          Animated.timing(textOpacity, {
            toValue: 1,
            duration: HALF,
            delay: HALF,
            useNativeDriver: true,
          }).start()
        } else {
          // Text fades out during first half, then pill collapses.
          Animated.timing(textOpacity, {
            toValue: 0,
            duration: HALF,
            useNativeDriver: true,
          }).start(() => {
            LayoutAnimation.configureNext(
              LayoutAnimation.create(
                COLLAPSE_MS,
                'easeInEaseOut',
                'opacity'
              ) as any
            )
            setExpanded(false)
          })
        }
      }}
      accessibilityRole="button"
      accessibilityLabel="Transfer status"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {el}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: 'rgba(36,41,47,1)',
    borderColor: '#24292f',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  badgeExpanded: {
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  iconRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  exclaim: { fontSize: 12, fontWeight: '800', marginLeft: 2 },
  errorBox: {
    marginTop: 4,
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  errorText: { color: '#991b1b', fontSize: 12 },
})
