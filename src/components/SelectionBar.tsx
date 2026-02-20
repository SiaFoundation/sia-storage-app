import { Trash2Icon } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useSelectedCount } from '../stores/fileSelection'
import { palette } from '../styles/colors'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { IconButton } from './IconButton'

type Props = {
  onOpenSelectionActions: () => void
}

export function SelectionBar({ onOpenSelectionActions }: Props) {
  const selectedCount = useSelectedCount()

  return (
    <BottomControlBar style={styles.bar}>
      <View style={styles.container}>
        <View style={styles.spacer} />
        <Text style={styles.count}>
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select items'}
        </Text>
        <IconButton
          onPress={onOpenSelectionActions}
          disabled={selectedCount === 0}
          accessibilityLabel="Delete"
        >
          <Trash2Icon
            color={selectedCount > 0 ? palette.red[500] : iconColors.inactive}
            size={20}
          />
        </IconButton>
      </View>
    </BottomControlBar>
  )
}

const styles = StyleSheet.create({
  bar: {
    width: '90%',
    maxWidth: 600,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  count: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
  },
  spacer: {
    width: 20,
  },
})
