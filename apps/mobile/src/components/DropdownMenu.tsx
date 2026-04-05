import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { overlay, palette, whiteA } from '../styles/colors'

export type MenuItem =
  | {
      type: 'checkbox'
      key: string
      label: string
      checked: boolean
      onPress: () => void
    }
  | { type: 'separator' }
  | {
      type: 'submenu'
      key: string
      label: string
      items: MenuItem[]
    }

type Props = {
  trigger: React.ReactNode
  items: MenuItem[]
}

export function DropdownMenu({ trigger, items }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [triggerLayout, setTriggerLayout] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const triggerRef = useRef<View>(null)
  const progress = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(0)).current
  const [, setClosing] = useState(false)

  const open = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setTriggerLayout({ x, y, width, height })
      setIsOpen(true)
      setClosing(false)
      setActiveSubmenu(null)
      slideAnim.setValue(0)
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        tension: 200,
        friction: 22,
      }).start()
    })
  }, [progress, slideAnim])

  const close = useCallback(() => {
    setClosing(true)
    Animated.timing(progress, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setIsOpen(false)
      setClosing(false)
      setActiveSubmenu(null)
    })
  }, [progress])

  const openSubmenu = useCallback(
    (key: string) => {
      setActiveSubmenu(key)
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 200,
        friction: 22,
      }).start()
    },
    [slideAnim],
  )

  const closeSubmenu = useCallback(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 200,
      friction: 22,
    }).start(() => {
      setActiveSubmenu(null)
    })
  }, [slideAnim])

  const handleItemPress = useCallback((item: MenuItem) => {
    if (item.type === 'checkbox') {
      item.onPress()
    }
  }, [])

  const submenuItem = activeSubmenu
    ? items.find((i) => i.type === 'submenu' && i.key === activeSubmenu)
    : null
  const submenuItems = submenuItem && submenuItem.type === 'submenu' ? submenuItem.items : []

  const screen = Dimensions.get('window')
  const MENU_WIDTH = 240
  const statusBarOffset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
  const menuRight = triggerLayout.x + triggerLayout.width
  const menuLeft = Math.max(8, Math.min(menuRight - MENU_WIDTH, screen.width - MENU_WIDTH - 8))
  const menuTop = triggerLayout.y + triggerLayout.height + 6 + statusBarOffset

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  })
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  })
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  })

  const rootSlide = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -MENU_WIDTH],
  })
  const subSlide = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [MENU_WIDTH, 0],
  })

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable onPress={open}>
          <View pointerEvents="none">{trigger}</View>
        </Pressable>
      </View>
      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={close}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <Animated.View
          style={[
            styles.menuContainer,
            {
              left: menuLeft,
              top: menuTop,
              width: MENU_WIDTH,
              opacity,
              transform: [{ scale }, { translateY }],
            },
          ]}
        >
          <View style={styles.menuOverflow}>
            <Animated.View
              style={[
                styles.menuPage,
                { width: MENU_WIDTH, transform: [{ translateX: rootSlide }] },
              ]}
            >
              {renderItems(items, handleItemPress, openSubmenu)}
            </Animated.View>
            {activeSubmenu ? (
              <Animated.View
                style={[
                  styles.submenuPage,
                  {
                    width: MENU_WIDTH,
                    transform: [{ translateX: subSlide }],
                  },
                ]}
              >
                <Pressable style={styles.submenuBack} onPress={closeSubmenu}>
                  <ChevronLeftIcon size={16} color={palette.blue[400]} />
                  <Text style={styles.submenuBackText}>
                    {submenuItem && submenuItem.type === 'submenu' ? submenuItem.label : ''}
                  </Text>
                </Pressable>
                <View style={styles.separator} />
                {renderItems(submenuItems, handleItemPress, openSubmenu)}
              </Animated.View>
            ) : null}
          </View>
        </Animated.View>
      </Modal>
    </>
  )
}

function renderItems(
  items: MenuItem[],
  onPress: (item: MenuItem) => void,
  onOpenSubmenu: (key: string) => void,
) {
  return items.map((item, index) => {
    if (item.type === 'separator') {
      return <View key={`sep-${index}`} style={styles.separator} />
    }
    if (item.type === 'submenu') {
      return (
        <Pressable
          key={item.key}
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          onPress={() => onOpenSubmenu(item.key)}
        >
          <Text style={styles.menuItemText}>{item.label}</Text>
          <ChevronRightIcon size={16} color={whiteA.a50} />
        </Pressable>
      )
    }
    return (
      <Pressable
        key={item.key}
        style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
        onPress={() => onPress(item)}
      >
        <View style={styles.checkArea}>
          {item.checked ? <CheckIcon size={15} color={palette.gray[50]} /> : null}
        </View>
        <Text style={[styles.menuItemText, item.checked && styles.menuItemTextChecked]}>
          {item.label}
        </Text>
      </Pressable>
    )
  })
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menuContainer: {
    position: 'absolute',
    backgroundColor: overlay.menu,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
    paddingVertical: 4,
  },
  menuOverflow: {
    overflow: 'hidden',
    borderRadius: 14,
    flexDirection: 'row',
  },
  menuPage: {
    flexShrink: 0,
  },
  submenuPage: {
    position: 'absolute',
    top: 0,
    left: 0,
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
  },
  menuItemPressed: {
    backgroundColor: whiteA.a08,
  },
  checkArea: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    color: palette.gray[200],
    fontSize: 16,
    flex: 1,
  },
  menuItemTextChecked: {
    color: palette.gray[50],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: whiteA.a08,
    marginVertical: 4,
  },
  submenuBack: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  submenuBackText: {
    color: palette.blue[400],
    fontSize: 16,
    fontWeight: '600',
  },
})
