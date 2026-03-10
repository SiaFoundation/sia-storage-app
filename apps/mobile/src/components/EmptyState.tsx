import type { ReactNode } from 'react'
import {
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { palette, whiteA } from '../styles/colors'

type Props = {
  image: ImageSourcePropType
  title: string
  message: string
  action?: {
    label: string
    onPress: () => void
  }
  children?: ReactNode
}

export function EmptyState({ image, title, message, action, children }: Props) {
  return (
    <View style={styles.wrap}>
      <Image style={styles.image} source={image} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={action.onPress}
        >
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  image: { width: 140, height: 140 },
  title: {
    color: palette.gray[100],
    fontWeight: '800',
    fontSize: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  message: {
    color: whiteA.a70,
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: palette.blue[500],
  },
  buttonText: {
    color: palette.gray[50],
    fontSize: 15,
    fontWeight: '700',
  },
})
