import React, { useMemo, useRef, useState } from 'react'
import {
  View,
  StyleSheet,
  Pressable,
  LayoutAnimation,
  Animated,
  AccessibilityRole,
  Text,
} from 'react-native'
import { palette } from '../styles/colors'
import type { StyleProp, ViewStyle, TextStyle } from 'react-native'

export type ExpandableBadgeProps = {
  label?: string
  hint?: string
  size?: number
  interactive?: boolean
  backgroundColor?: string
  borderColor?: string
  textColor?: string
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  children?: React.ReactNode
  accessibilityLabel?: string
  accessibilityRole?: AccessibilityRole
  initialExpanded?: boolean
}

export function ExpandableBadge({
  label,
  hint,
  size = 16,
  interactive = false,
  backgroundColor,
  borderColor,
  textColor,
  style,
  textStyle,
  children,
  accessibilityLabel,
  accessibilityRole = 'button',
  initialExpanded = false,
}: ExpandableBadgeProps) {
  const [expanded, setExpanded] = useState<boolean>(initialExpanded)
  const textOpacity = useRef(
    new Animated.Value(initialExpanded ? 1 : 0)
  ).current

  const effectiveBg = backgroundColor ?? 'rgba(36,41,47,1)'
  const effectiveBorder = borderColor ?? palette.gray[975]
  const effectiveText = textColor ?? palette.gray[50]
  const textStyles = useMemo(() => {
    return [
      styles.pillText,
      { fontSize: size * 0.75, color: effectiveText },
      textStyle,
    ]
  }, [size, effectiveText, textOpacity, textStyle])

  const textEl = useMemo(() => {
    if (!expanded || !label) return null
    return (
      <Animated.Text
        style={[textStyles, { opacity: textOpacity }]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    )
  }, [expanded, label, size, effectiveText, textOpacity, textStyles])

  const content = (
    <View
      style={[
        styles.badge,
        expanded ? styles.badgeExpanded : null,
        { backgroundColor: effectiveBg, borderColor: effectiveBorder },
        style,
      ]}
    >
      {textEl}
      {hint && <Text style={textStyles}>{hint}</Text>}
      {children}
    </View>
  )

  if (!interactive) return content

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
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hint: { fontSize: 10, color: palette.gray[50] },
  badge: {
    backgroundColor: 'rgba(36,41,47,1)',
    borderColor: palette.gray[975],
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
    fontWeight: '600',
  },
})
