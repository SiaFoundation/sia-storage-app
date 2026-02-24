import type { ReactNode } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, palette } from '../styles/colors'

type Props = {
  visible: boolean
  onRequestClose: () => void
  title: string
  headerRight?: ReactNode
  presentationStyle?: 'pageSheet' | 'formSheet'
  children: ReactNode
}

export function ModalSheet({
  visible,
  onRequestClose,
  title,
  headerRight,
  presentationStyle = 'pageSheet',
  children,
}: Props) {
  const insets = useSafeAreaInsets()

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={presentationStyle}
      onRequestClose={onRequestClose}
      onDismiss={onRequestClose}
    >
      <View style={styles.container}>
        <View
          style={[
            styles.header,
            {
              paddingTop:
                Platform.OS === 'android' ? Math.max(20, insets.top) : 20,
            },
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          <View style={styles.headerRight}>
            {headerRight ?? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done"
                onPress={onRequestClose}
                hitSlop={8}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>
        {children}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    color: palette.gray[50],
    fontSize: 17,
    fontWeight: '700',
  },
  doneText: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
})
