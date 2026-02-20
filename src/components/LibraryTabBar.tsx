import { FilePlusIcon } from 'lucide-react-native'
import { StyleSheet } from 'react-native'
import { openSheet } from '../stores/sheets'
import { palette } from '../styles/colors'
import { BottomControlBar, FloatingPill } from './BottomControlBar'
import { IconButton } from './IconButton'

export function LibraryTabBar() {
  return (
    <BottomControlBar variant="floating" style={styles.bar}>
      <FloatingPill style={styles.actions}>
        <IconButton
          onPress={() => openSheet('addFile')}
          accessibilityLabel="Add files"
        >
          <FilePlusIcon color={palette.gray[50]} size={20} />
        </IconButton>
      </FloatingPill>
    </BottomControlBar>
  )
}

const styles = StyleSheet.create({
  bar: {
    width: '90%',
    maxWidth: 600,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  actions: {
    gap: 2,
  },
})
