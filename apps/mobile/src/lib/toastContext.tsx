import type React from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native'
import { colors, whiteA } from '../styles/colors'

type ToastContextValue = {
  show: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('ToastProvider missing')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const anim = useRef(new Animated.Value(0)).current
  const isShowingRef = useRef(false)

  const show = useCallback(
    (text: string) => {
      setMessage(text)
      if (isShowingRef.current) return
      isShowingRef.current = true
      anim.setValue(0)
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(1200),
        Animated.timing(anim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        isShowingRef.current = false
        setMessage(null)
      })
    },
    [anim],
  )

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
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastWrap,
            {
              transform: [{ translateY }, { scale }],
              opacity,
            },
          ]}
        >
          <View style={styles.toastCard}>
            <Text style={styles.toastText} accessibilityLabel={message}>
              {message}
            </Text>
          </View>
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
    bottom: Platform.select({ ios: 100, android: 64, default: 64 }),
    alignItems: 'center',
    zIndex: 999,
  },
  toastCard: {
    backgroundColor: colors.bgPill,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderColor: whiteA.a08,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toastText: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
})
