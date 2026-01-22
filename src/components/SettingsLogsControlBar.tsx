import {
  useLogLevel,
  useLogScopes,
  useAvailableScopes,
  setLogLevel,
  setLogScopes,
  toggleLogScope,
  clearLogs,
} from '../stores/logs'
import { exportLogs } from '../lib/exportLogs'
import { type LogLevel } from '../lib/logger'
import { logger } from '../lib/logger'
import { logsSwr } from '../hooks/useLogs'
import { Alert } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MenuStackParamList } from '../stacks/types'
import { iconColors } from './BottomControlBar'
import {
  FilterIcon,
  DownloadIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react-native'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { IconButton } from './IconButton'
import { useToast } from '../lib/toastContext'
import { BottomControlBar } from './BottomControlBar'
import { ActionSheet } from './ActionSheet'
import { closeSheet, useSheetOpen, openSheet } from '../stores/sheets'
import { palette } from '../styles/colors'
import { useState } from 'react'
import { SpinnerIcon } from './SpinnerIcon'

type Props = NativeStackScreenProps<MenuStackParamList, 'Logs'> & {
  onRefresh?: () => void
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

export function SettingsLogsControlBar({ navigation, onRefresh }: Props) {
  const logLevel = useLogLevel()
  const logScopes = useLogScopes()
  const availableScopes = useAvailableScopes()
  const levelSheetOpen = useSheetOpen('logLevel')
  const scopeSheetOpen = useSheetOpen('logScopes')
  const toast = useToast()
  const [isExporting, setIsExporting] = useState(false)

  const handleExportLogs = async () => {
    if (isExporting) {
      return
    }
    setIsExporting(true)
    try {
      const fileId = await exportLogs()
      if (fileId) {
        toast.show('Logs exported to library')
        // Navigate to the exported file.
        const parentNav = navigation.getParent()
        if (parentNav) {
          parentNav.navigate('MainTab', {
            screen: 'FileDetail',
            params: { id: fileId },
          })
        }
      } else {
        toast.show('No logs to export')
      }
    } catch (error) {
      logger.error('logs', 'Failed to export logs', error)
      toast.show('Failed to export logs')
    } finally {
      setIsExporting(false)
    }
  }

  const handleLevelSelect = async (level: LogLevel) => {
    await setLogLevel(level)
    closeSheet()
    toast.show(`Log level set to ${level}`)
  }

  const handleScopeToggle = async (scope: string) => {
    await toggleLogScope(scope)
    const newScopes = logScopes.includes(scope)
      ? logScopes.filter((s) => s !== scope)
      : [...logScopes, scope]
    toast.show(
      newScopes.length > 0
        ? `Showing ${newScopes.length} scope(s)`
        : 'Showing all scopes'
    )
  }

  const handleClearScopes = async () => {
    await setLogScopes([])
    closeSheet()
    toast.show('Showing all scopes')
  }

  const handleClearLogs = () => {
    Alert.alert(
      'Clear All Logs',
      'This will permanently delete all log entries. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearLogs()
              await logsSwr.triggerChange()
              toast.show('Logs cleared')
            } catch (error) {
              logger.error('logs', 'Failed to clear logs', error)
              toast.show('Failed to clear logs')
            }
          },
        },
      ]
    )
  }

  return (
    <>
      <BottomControlBar style={{ width: 360, maxWidth: '90%' }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Pressable
            onPress={() => openSheet('logLevel')}
            style={styles.filterButton}
          >
            <Text style={styles.filterButtonText}>
              {logLevel.toUpperCase()}
            </Text>
            <ChevronDownIcon size={16} color={iconColors.white} />
          </Pressable>
          <Pressable
            onPress={() => openSheet('logScopes')}
            style={styles.filterButton}
          >
            <FilterIcon size={16} color={iconColors.white} />
            <Text style={styles.filterButtonText}>
              {logScopes.length > 0 ? `${logScopes.length}` : 'All'}
            </Text>
            <ChevronDownIcon size={16} color={iconColors.white} />
          </Pressable>
          {onRefresh && (
            <IconButton onPress={onRefresh}>
              <RefreshCwIcon color={iconColors.white} />
            </IconButton>
          )}
          <IconButton onPress={handleExportLogs} disabled={isExporting}>
            {isExporting ? (
              <SpinnerIcon size={20} color={iconColors.white} />
            ) : (
              <DownloadIcon color={iconColors.white} />
            )}
          </IconButton>
          <IconButton onPress={handleClearLogs}>
            <Trash2Icon color={iconColors.white} />
          </IconButton>
        </View>
      </BottomControlBar>

      <ActionSheet visible={levelSheetOpen} onRequestClose={closeSheet}>
        <Text style={styles.sheetTitle}>Log Level</Text>
        {LOG_LEVELS.map((level) => (
          <Pressable
            key={level}
            style={styles.sheetRow}
            onPress={() => handleLevelSelect(level)}
          >
            <Text
              style={[
                styles.sheetRowText,
                logLevel === level && styles.sheetRowTextSelected,
              ]}
            >
              {level.toUpperCase()}
            </Text>
            {logLevel === level && <Text style={styles.sheetRowCheck}>✓</Text>}
          </Pressable>
        ))}
      </ActionSheet>

      <ActionSheet
        visible={scopeSheetOpen}
        onRequestClose={closeSheet}
        snapPoints={['70%']}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={styles.sheetTitle}>Scopes</Text>
          {logScopes.length > 0 && (
            <Pressable onPress={handleClearScopes}>
              <Text style={styles.clearButton}>Clear</Text>
            </Pressable>
          )}
        </View>
        {availableScopes.length === 0 ? (
          <Text style={styles.emptyText}>No scopes available yet</Text>
        ) : (
          availableScopes.map((scope) => {
            const isSelected = logScopes.includes(scope)
            return (
              <Pressable
                key={scope}
                style={styles.sheetRow}
                onPress={() => handleScopeToggle(scope)}
              >
                <Text
                  style={[
                    styles.sheetRowText,
                    isSelected && styles.sheetRowTextSelected,
                  ]}
                >
                  {scope}
                </Text>
                {isSelected && <Text style={styles.sheetRowCheck}>✓</Text>}
              </Pressable>
            )
          })
        )}
      </ActionSheet>
    </>
  )
}

const styles = StyleSheet.create({
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.gray[700],
    borderRadius: 8,
  },
  filterButtonText: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
  },
  sheetTitle: {
    color: palette.gray[50],
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sheetRowText: {
    color: palette.gray[200],
    fontSize: 16,
  },
  sheetRowTextSelected: {
    color: palette.gray[50],
    fontWeight: '600',
  },
  sheetRowCheck: {
    color: palette.blue[400],
    fontSize: 18,
    fontWeight: '600',
  },
  clearButton: {
    color: palette.blue[400],
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    color: palette.gray[400],
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
})
