import React from 'react'
import { Keyboard, TouchableWithoutFeedback, View } from 'react-native'

type Props = {
  children: React.ReactNode
  disabled?: boolean
}

export function KeyboardDismissArea({ children, disabled = false }: Props) {
  if (disabled) return <>{children}</>
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={{ flex: 1 }}>{children}</View>
    </TouchableWithoutFeedback>
  )
}
