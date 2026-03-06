import type { Category } from '@siastorage/core/db/operations'
import { EllipsisIcon, ListFilterIcon, XIcon } from 'lucide-react-native'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { overlay, palette, whiteA } from '../styles/colors'
import { IconButton } from './IconButton'
import { LibraryAppStatusIcon } from './LibraryAppStatusIcon'
import { ScreenHeader } from './ScreenHeader'
import { ViewSettingsMenu } from './ViewSettingsMenu'

type Props = {
  title: string
  subtitle: string
  showViewSettings?: boolean
  scope?: string
  allowedCategories?: readonly Category[]
  isSelectionMode?: boolean
  selectedCount?: number
  onEnterSelection?: () => void
  onExitSelection?: () => void
  onOpenSelectionActions?: () => void
  onNavigateMenu: () => void
}

export function LibraryHeader({
  title,
  subtitle,
  showViewSettings = true,
  scope = 'library',
  allowedCategories,
  isSelectionMode,
  selectedCount,
  onEnterSelection,
  onExitSelection,
  onOpenSelectionActions,
  onNavigateMenu,
}: Props) {
  return (
    <ScreenHeader>
      <View style={styles.headerLeft}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={onNavigateMenu}
          style={styles.shardButton}
        >
          <Image
            source={require('../assets/icon.png')}
            style={styles.shardIcon}
          />
        </Pressable>
        <View>
          <Text style={styles.titleLarge} pointerEvents="none">
            {title}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.buttonRow}>
        <LibraryAppStatusIcon />
        {showViewSettings ? (
          <ViewSettingsMenu scope={scope} allowedCategories={allowedCategories}>
            <IconButton accessibilityLabel="View settings">
              <ListFilterIcon color={palette.gray[50]} size={22} />
            </IconButton>
          </ViewSettingsMenu>
        ) : null}
        {onEnterSelection &&
          (isSelectionMode ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More actions"
                onPress={onOpenSelectionActions}
                disabled={!selectedCount}
                style={[styles.headerPill, !selectedCount && styles.disabled]}
              >
                <EllipsisIcon
                  color={selectedCount ? palette.gray[50] : whiteA.a50}
                  size={20}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Exit selection mode"
                onPress={onExitSelection}
                style={styles.headerPill}
              >
                <XIcon color={palette.gray[50]} size={18} />
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enter selection mode"
              onPress={onEnterSelection}
              style={styles.headerPill}
            >
              <Text style={styles.selectText}>Select</Text>
            </Pressable>
          ))}
      </View>
    </ScreenHeader>
  )
}

const styles = StyleSheet.create({
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
  },
  shardButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: overlay.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  titleLarge: {
    color: palette.gray[50],
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: overlay.pill,
  },
  selectText: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
})
