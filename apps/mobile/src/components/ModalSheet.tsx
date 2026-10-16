import type { ReactNode } from 'react'
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, palette } from '../styles/colors'
import { DimSurface } from './DimSurface'

type Props = {
  visible: boolean
  onRequestClose: () => void
  onShow?: () => void
  title: string
  headerRight?: ReactNode
  presentationStyle?: 'pageSheet' | 'formSheet'
  children: ReactNode
}

export function ModalSheet({
  visible,
  onRequestClose,
  onShow,
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
      onShow={onShow}
    >
      <DimSurface>
        <SafeAreaProvider>
          <SheetFrame>
            <View
              style={[
                styles.header,
                {
                  paddingTop: Platform.OS === 'android' ? Math.max(20, insets.top) : 20,
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
          </SheetFrame>
        </SafeAreaProvider>
      </DimSurface>
    </Modal>
  )
}

/**
 * Keeps the sheet's content clear of its own side insets. A page sheet fills
 * the width of a compact screen, and an iPhone Duo's cover screen has its
 * status bar down the right edge, so without this the Done button sits under
 * the clock. The app's provider reports the main window's insets, not the
 * sheet's, so these come from the provider inside the modal.
 */
function SheetFrame({ children }: { children: ReactNode }) {
  const { left, right } = useSafeAreaInsets()
  return (
    <View style={[styles.container, { paddingLeft: left, paddingRight: right }]}>{children}</View>
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
