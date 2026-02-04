import { MoreVerticalIcon } from 'lucide-react-native'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { closeSheet, openSheet, useSheetOpen } from '../stores/sheets'
import { ActionSheet } from './ActionSheet'
import { ActionSheetButton } from './ActionSheetButton'
import { iconColors } from './BottomControlBar'
import { IconButton } from './IconButton'

export type OverflowAction = {
  key: string
  icon: ReactNode
  label: string
  onPress: () => void
  variant?: 'primary' | 'danger'
  disabled?: boolean
}

type Props = {
  actions: OverflowAction[]
  sheetName: string
}

const ICON_BUTTON_SIZE = 36
const GAP = 12
const SLOT_WIDTH = ICON_BUTTON_SIZE + GAP

export function OverflowActions({ actions, sheetName }: Props) {
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const sheetOpen = useSheetOpen(sheetName)

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout
    setContainerWidth(width)
  }, [])

  const { visibleActions, overflowActions } = useMemo(() => {
    // Before measurement, show nothing to avoid clipping
    if (containerWidth === null) {
      return { visibleActions: [], overflowActions: [] }
    }

    const maxSlots = Math.max(
      1,
      Math.floor((containerWidth + GAP) / SLOT_WIDTH),
    )

    if (actions.length <= maxSlots) {
      return { visibleActions: actions, overflowActions: [] }
    }

    const visibleCount = maxSlots - 1
    return {
      visibleActions: actions.slice(0, visibleCount),
      overflowActions: actions.slice(visibleCount),
    }
  }, [actions, containerWidth])

  const handleOverflowPress = useCallback(() => {
    openSheet(sheetName)
  }, [sheetName])

  const handleOverflowActionPress = useCallback((action: OverflowAction) => {
    closeSheet()
    action.onPress()
  }, [])

  return (
    <>
      <View style={styles.container} onLayout={handleLayout}>
        {visibleActions.map((action) => (
          <IconButton
            key={action.key}
            onPress={action.onPress}
            disabled={action.disabled}
          >
            {action.icon}
          </IconButton>
        ))}
        {overflowActions.length > 0 && (
          <IconButton onPress={handleOverflowPress}>
            <MoreVerticalIcon color={iconColors.white} />
          </IconButton>
        )}
      </View>

      <ActionSheet visible={sheetOpen} onRequestClose={closeSheet}>
        {overflowActions.map((action) => (
          <ActionSheetButton
            key={action.key}
            icon={action.icon}
            variant={action.variant ?? 'primary'}
            disabled={action.disabled}
            onPress={() => handleOverflowActionPress(action)}
          >
            {action.label}
          </ActionSheetButton>
        ))}
      </ActionSheet>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: GAP,
  },
})
