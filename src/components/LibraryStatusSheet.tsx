import { useCallback } from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import useSWR from 'swr'
import { useIsOnline } from '../hooks/useIsOnline'
import { humanSize } from '../lib/humanSize'
import { humanUploadPercent } from '../lib/uploadPercent'
import type { UploadCategoryStats } from '../stores/fileStats'
import { getUploadStats } from '../stores/fileStats'
import { useFileStatsLocal, useFileStatsLost } from '../stores/files'
import { useIsConnected } from '../stores/sdk'
import { setStatusDisplayMode, useStatusDisplayMode } from '../stores/settings'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { palette, whiteA } from '../styles/colors'
import { RowGroup, RowSubGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { ModalSheet } from './ModalSheet'

const refreshInterval = 5_000

function formatDeviceValue(
  data: { count: number; totalBytes: number } | undefined,
  overall: { total: number; totalBytes: number } | undefined,
  mode: 'count' | 'size',
): string {
  if (!data || !overall) return mode === 'count' ? '0 / 0' : '0 B / 0 B'
  if (mode === 'size') {
    return `${humanSize(data.totalBytes) ?? '0 B'} / ${humanSize(overall.totalBytes) ?? '0 B'}`
  }
  return `${data.count.toLocaleString()} / ${overall.total.toLocaleString()}`
}

function devicePercent(
  data: { count: number; totalBytes: number } | undefined,
  overall: { totalBytes: number } | undefined,
): number | undefined {
  if (!data || !overall || !overall.totalBytes) return undefined
  return data.totalBytes / overall.totalBytes
}

function formatCategoryValue(
  cat: UploadCategoryStats | undefined,
  mode: 'count' | 'size',
): string {
  if (!cat) return mode === 'count' ? '0 / 0' : '0 B / 0 B'
  if (mode === 'size') {
    return `${humanSize(cat.uploadedBytes) ?? '0 B'} / ${humanSize(cat.totalBytes) ?? '0 B'}`
  }
  return `${cat.uploaded.toLocaleString()} / ${cat.total.toLocaleString()}`
}

export function LibraryStatusSheet() {
  const isConnected = useIsConnected()
  const isOnline = useIsOnline()
  const isOpen = useSheetOpen('libraryStatus')
  const { data: displayMode = 'count' } = useStatusDisplayMode()
  const stats = useSWR(
    ['upload-stats', isOpen ?? null],
    () => getUploadStats(),
    {
      refreshInterval,
    },
  )
  const onDevice = useFileStatsLocal({ localOnly: false }, { refreshInterval })
  const pendingBackup = useFileStatsLocal(
    { localOnly: true },
    { refreshInterval },
  )
  const lost = useFileStatsLost({ refreshInterval })

  const handleClose = useCallback(() => {
    closeSheet()
  }, [])

  const toggle = (
    <View style={styles.toggleTrack}>
      {(['count', 'size'] as const).map((mode) => (
        <Pressable
          key={mode}
          style={[
            styles.toggleSegment,
            displayMode === mode && styles.toggleSegmentSelected,
          ]}
          onPress={() => setStatusDisplayMode(mode)}
        >
          <Text
            style={[
              styles.toggleLabel,
              displayMode === mode && styles.toggleLabelSelected,
            ]}
          >
            {mode === 'count' ? 'Count' : 'Size'}
          </Text>
        </Pressable>
      ))}
    </View>
  )

  return (
    <ModalSheet visible={isOpen} onRequestClose={handleClose} title="Status">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <RowGroup title="Connectivity" style={styles.groupSpacing}>
          <InfoCard>
            <LabeledValueRow
              label="Internet"
              align="right"
              value={
                <View style={styles.valueRight}>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.valueText}>
                    {typeof isOnline.data === 'boolean'
                      ? isOnline.data
                        ? 'Online'
                        : 'Offline'
                      : '—'}
                  </Text>
                  <View
                    style={isOnline.data ? styles.dotOnline : styles.dotOffline}
                  />
                </View>
              }
              canCopy={false}
            />
            <LabeledValueRow
              label="Indexer"
              value={
                <View style={styles.valueRight}>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.valueText}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </Text>
                  <View
                    style={isConnected ? styles.dotOnline : styles.dotOffline}
                  />
                </View>
              }
              showDividerTop
              canCopy={false}
            />
          </InfoCard>
        </RowGroup>

        <RowGroup title="Files" indicator={toggle} style={styles.groupSpacing}>
          <RowSubGroup title="Network" style={styles.subGroupSpacing}>
            <InfoCard>
              <LabeledValueRow
                label="Files"
                labelStyle={styles.boldLabel}
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.files, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.files.percentDecimal,
                        stats.data?.files.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
              />
              <LabeledValueRow
                label="  Photos"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.photos, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.photos.percentDecimal,
                        stats.data?.photos.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
              <LabeledValueRow
                label="  Videos"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.videos, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.videos.percentDecimal,
                        stats.data?.videos.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
              <LabeledValueRow
                label="  Audio"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.audio, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.audio.percentDecimal,
                        stats.data?.audio.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
              <LabeledValueRow
                label="  Docs"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.docs, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.docs.percentDecimal,
                        stats.data?.docs.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
              <LabeledValueRow
                label="  Other"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.other, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.other.percentDecimal,
                        stats.data?.other.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
            </InfoCard>
            <View style={styles.networkGroupGap} />
            <InfoCard>
              <LabeledValueRow
                label="Thumbnails"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.thumbnails, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.thumbnails.percentDecimal,
                        stats.data?.thumbnails.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
              />
            </InfoCard>
            <View style={styles.networkGroupGap} />
            <InfoCard>
              <LabeledValueRow
                label="All"
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatCategoryValue(stats.data?.overall, displayMode)}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        stats.data?.overall.percentDecimal,
                        stats.data?.overall.percent,
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
              />
            </InfoCard>
          </RowSubGroup>
          <RowSubGroup title="Device" style={styles.subGroupSpacing}>
            <InfoCard>
              <LabeledValueRow
                label="On device"
                labelWidth={120}
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatDeviceValue(
                        onDevice.data,
                        stats.data?.overall,
                        displayMode,
                      )}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        devicePercent(onDevice.data, stats.data?.overall),
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
              />
              <LabeledValueRow
                label="Pending backup"
                labelWidth={120}
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatDeviceValue(
                        pendingBackup.data,
                        stats.data?.overall,
                        displayMode,
                      )}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        devicePercent(pendingBackup.data, stats.data?.overall),
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
              <LabeledValueRow
                label="Lost"
                labelWidth={120}
                value={
                  <View style={styles.valueRight}>
                    <Text style={styles.valueText}>
                      {formatDeviceValue(
                        lost.data,
                        stats.data?.overall,
                        displayMode,
                      )}
                    </Text>
                    <Text style={styles.valuePercent}>
                      {humanUploadPercent(
                        devicePercent(lost.data, stats.data?.overall),
                      )}
                    </Text>
                  </View>
                }
                align="right"
                canCopy={false}
                showDividerTop
              />
            </InfoCard>
          </RowSubGroup>
        </RowGroup>
      </ScrollView>
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 48,
    gap: 14,
  },
  groupSpacing: { marginTop: 8 },
  subGroupSpacing: { marginTop: 12 },
  networkGroupGap: { height: 8 },
  boldLabel: { fontWeight: '700' },
  toggleTrack: {
    flexDirection: 'row',
    backgroundColor: whiteA.a08,
    borderRadius: 8,
    padding: 2,
  },
  toggleSegment: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleSegmentSelected: {
    backgroundColor: whiteA.a10,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.gray[400],
  },
  toggleLabelSelected: {
    color: palette.gray[50],
  },
  valueRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-end',
    width: '100%',
    flex: 1,
  },
  valueText: {
    color: palette.gray[100],
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13,
  },
  valuePercent: {
    color: palette.gray[400],
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13,
  },
  dotOnline: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.green[500],
  },
  dotOffline: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.red[500],
  },
})
