import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, whiteA } from '../styles/colors'

type ToastTone = 'normal' | 'error'
type ToastOptions = { tone?: ToastTone }
type ToastContextValue = {
  show: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

// Error toasts get longer because their content is usually multi-line; the
// user can always dismiss earlier by tapping.
const AUTO_DISMISS_MS_NORMAL = 3000
const AUTO_DISMISS_MS_ERROR = 6000

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('ToastProvider missing')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const anim = useRef(new Animated.Value(0)).current
  const isShowingRef = useRef(false)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Add the system-bar inset on top of a base lift so the toast always
  // sits clear of the Android nav bar (3-button or gesture pill) regardless
  // of whether the app is edge-to-edge. iOS keeps its fixed lift that
  // already clears the tab bar / home indicator.
  const insets = useSafeAreaInsets()
  const bottomOffset = Platform.select({
    ios: 100,
    android: 80 + insets.bottom,
    default: 64,
  })

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearDismissTimer()
    if (!isShowingRef.current) return
    Animated.timing(anim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      isShowingRef.current = false
      setMessage(null)
    })
  }, [anim, clearDismissTimer])

  const show = useCallback(
    (text: string, options?: ToastOptions) => {
      setMessage(text)
      // Reset the dismiss timer for every new message — a fresh tap restarts
      // the read window even if a previous toast is still on screen.
      clearDismissTimer()
      if (!isShowingRef.current) {
        isShowingRef.current = true
        anim.setValue(0)
        Animated.timing(anim, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start()
      }
      const duration = options?.tone === 'error' ? AUTO_DISMISS_MS_ERROR : AUTO_DISMISS_MS_NORMAL
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null
        hide()
      }, duration)
    },
    [anim, clearDismissTimer, hide],
  )

  // Clear the timer if the provider unmounts mid-toast.
  useEffect(() => clearDismissTimer, [clearDismissTimer])

  const ctx = useMemo(() => ({ show }), [show])

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  })
  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1],
  })
  const opacity = anim

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {message ? (
        // box-none so the wrapper itself doesn't capture touches outside
        // the card — only the card's Pressable handles tap-to-dismiss.
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.toastWrap,
            {
              bottom: bottomOffset,
              transform: [{ translateY }, { scale }],
              opacity,
            },
          ]}
        >
          <Pressable
            onPress={hide}
            accessibilityRole="button"
            accessibilityLabel={`${message}. Tap to dismiss.`}
            accessibilityHint="Dismisses the status toast"
          >
            <View style={styles.toastCard}>
              <Text style={styles.toastText}>{message}</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  )
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // `bottom` is set inline from useSafeAreaInsets so the toast sits
    // above the Android nav bar / iOS home indicator.
    // Always leave 16pt of breathing room between the card and the screen
    // edge so long messages can't touch the sides.
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 999,
  },
  toastCard: {
    backgroundColor: colors.bgPill,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderColor: whiteA.a08,
    borderWidth: StyleSheet.hairlineWidth,
    // Cap card width so multi-line messages stay readable on tablets;
    // phones will naturally cap themselves via the wrap's padding.
    maxWidth: 600,
  },
  toastText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
})
