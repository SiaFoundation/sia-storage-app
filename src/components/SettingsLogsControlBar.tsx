import Clipboard from '@react-native-clipboard/clipboard'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FilterIcon,
  Trash2Icon,
} from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { logsCache } from '../hooks/useLogs'
import { exportLogs } from '../lib/exportLogs'
import { type LogLevel, logger } from '../lib/logger'
import { useToast } from '../lib/toastContext'
import type { MenuStackParamList } from '../stacks/types'
import {
  clearLogs,
  readLogs,
  setLogLevel,
  setLogScopes,
  toggleLogScope,
  useAvailableScopes,
  useLogLevel,
  useLogScopes,
  useLogsStore,
} from '../stores/logs'
import { closeSheet, openSheet, useSheetOpen } from '../stores/sheets'
import { palette, whiteA } from '../styles/colors'
import { ActionSheet } from './ActionSheet'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { ModalSheet } from './ModalSheet'
import { type OverflowAction, OverflowActions } from './OverflowActions'
import { SpinnerIcon } from './SpinnerIcon'

type Props = NativeStackScreenProps<MenuStackParamList, 'Logs'>

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

export function SettingsLogsControlBar({ navigation }: Props) {
  const logLevel = useLogLevel()
  const logScopes = useLogScopes()
  const { data: availableScopes = [] } = useAvailableScopes()
  const levelSheetOpen = useSheetOpen('logLevel')
  const scopeSheetOpen = useSheetOpen('logScopes')
  const toast = useToast()
  const [isExporting, setIsExporting] = useState(false)

  const handleExportLogs = useCallback(async () => {
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
      logger.error('logs', 'export_failed', { error: error as Error })
      toast.show('Failed to export logs')
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, navigation, toast])

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
        : 'Showing all scopes',
    )
  }

  const handleClearScopes = async () => {
    await setLogScopes([])
    closeSheet()
    toast.show('Showing all scopes')
  }

  const handleClearLogs = useCallback(() => {
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
              await logsCache.invalidateAll()
              toast.show('Logs cleared')
            } catch (error) {
              logger.error('logs', 'clear_failed', { error: error as Error })
              toast.show('Failed to clear logs')
            }
          },
        },
      ],
    )
  }, [toast])

  const handleCopyLogs = useCallback(async () => {
    try {
      const state = useLogsStore.getState()
      const logs = await readLogs(state.logLevel, state.logScopes)
      if (logs.length === 0) {
        toast.show('No logs to copy')
        return
      }
      const content = logs
        .map((entry) =>
          JSON.stringify({
            ts: entry.timestamp,
            level: entry.level,
            scope: entry.scope,
            msg: entry.message,
            ...entry.data,
          }),
        )
        .join('\n')
      Clipboard.setString(content)
      toast.show('Logs copied')
    } catch (error) {
      logger.error('logs', 'copy_failed', { error: error as Error })
      toast.show('Failed to copy logs')
    }
  }, [toast])

  const actions: OverflowAction[] = useMemo(
    () => [
      {
        key: 'copy',
        icon: <CopyIcon color={iconColors.white} />,
        label: 'Copy to Clipboard',
        onPress: handleCopyLogs,
      },
      {
        key: 'export',
        icon: isExporting ? (
          <SpinnerIcon size={20} color={iconColors.white} />
        ) : (
          <DownloadIcon color={iconColors.white} />
        ),
        label: 'Save to Library',
        onPress: handleExportLogs,
        disabled: isExporting,
      },
      {
        key: 'clear',
        icon: <Trash2Icon color={iconColors.white} />,
        label: 'Clear Logs',
        onPress: handleClearLogs,
        variant: 'danger' as const,
      },
    ],
    [handleClearLogs, handleCopyLogs, handleExportLogs, isExporting],
  )

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
          <OverflowActions actions={actions} sheetName="logActions" />
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

      <ModalSheet
        visible={scopeSheetOpen}
        onRequestClose={closeSheet}
        title="Scopes"
        headerRight={
          <>
            {logScopes.length > 0 && (
              <Pressable onPress={handleClearScopes} hitSlop={8}>
                <Text style={styles.clearButton}>Clear</Text>
              </Pressable>
            )}
            <Pressable onPress={() => closeSheet()} hitSlop={8}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </>
        }
      >
        {availableScopes.length === 0 ? (
          <Text style={styles.emptyText}>No scopes available yet</Text>
        ) : (
          <FlatList
            data={availableScopes}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scopeListContent}
            renderItem={({ item: scope }) => {
              const isSelected = logScopes.includes(scope)
              return (
                <Pressable
                  style={styles.scopeRow}
                  onPress={() => handleScopeToggle(scope)}
                >
                  <Text
                    style={[
                      styles.scopeRowText,
                      isSelected && styles.scopeRowTextSelected,
                    ]}
                  >
                    {scope}
                  </Text>
                  {isSelected && <Text style={styles.scopeRowCheck}>✓</Text>}
                </Pressable>
              )
            }}
          />
        )}
      </ModalSheet>
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
  doneText: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
  emptyText: {
    color: palette.gray[400],
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  scopeListContent: {
    paddingBottom: 40,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whiteA.a08,
  },
  scopeRowText: {
    color: palette.gray[200],
    fontSize: 16,
  },
  scopeRowTextSelected: {
    color: palette.gray[50],
    fontWeight: '600',
  },
  scopeRowCheck: {
    color: palette.blue[400],
    fontSize: 18,
    fontWeight: '600',
  },
})
