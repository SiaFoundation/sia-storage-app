import { StyleSheet, Text, View } from 'react-native'
import useSWR from 'swr'
import { useIsOnline } from '../hooks/useIsOnline'
import { humanUploadPercent } from '../lib/uploadPercent'
import { getUploadStats } from '../stores/fileStats'
import { useFileCountLocal, useFileCountLost } from '../stores/files'
import { useIsConnected } from '../stores/sdk'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { palette } from '../styles/colors'
import { ActionSheet } from './ActionSheet'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'

export function LibraryStatusSheet() {
  const isConnected = useIsConnected()
  const isOnline = useIsOnline()
  const isOpen = useSheetOpen('libraryStatus')
  const stats = useSWR(
    ['upload-stats', isOpen ?? null],
    () => getUploadStats(),
    {
      refreshInterval: 5_000,
    },
  )
  const lostCount = useFileCountLost()
  const localCount = useFileCountLocal({ localOnly: false })
  const localOnlyCount = useFileCountLocal({ localOnly: true })

  return (
    <ActionSheet
      visible={isOpen}
      onRequestClose={() => closeSheet()}
      contentStyle={styles.sheetContent}
    >
      <View style={styles.sheetInnerDark}>
        <View style={styles.sheetHeaderRow}>
          <Text style={styles.sheetTitle}>App status</Text>
        </View>

        <RowGroup title="Connections" style={styles.groupSpacing}>
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

        <RowGroup title="Uploads" style={styles.groupSpacing}>
          <InfoCard>
            <LabeledValueRow
              label="Overall"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.overall.uploaded ?? 0} / ${
                      stats.data?.overall.total ?? 0
                    }`}
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
            <LabeledValueRow
              label="Photos"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.photos.uploaded ?? 0} / ${
                      stats.data?.photos.total ?? 0
                    }`}
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
              label="Videos"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.videos.uploaded ?? 0} / ${
                      stats.data?.videos.total ?? 0
                    }`}
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
              label="Audio"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.audio.uploaded ?? 0} / ${
                      stats.data?.audio.total ?? 0
                    }`}
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
              label="Docs"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.docs.uploaded ?? 0} / ${
                      stats.data?.docs.total ?? 0
                    }`}
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
              label="Other"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.other.uploaded ?? 0} / ${
                      stats.data?.other.total ?? 0
                    }`}
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
            <LabeledValueRow
              label="Thumbnails"
              value={
                <View style={styles.valueRight}>
                  <Text style={styles.valueText}>
                    {`${stats.data?.thumbnails.uploaded ?? 0} / ${
                      stats.data?.thumbnails.total ?? 0
                    }`}
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
              showDividerTop
            />
          </InfoCard>
        </RowGroup>
        <RowGroup title="Local storage" style={styles.groupSpacing}>
          <InfoCard>
            <LabeledValueRow
              label="Local files"
              value={
                <Text style={styles.valueText}>{localCount.data ?? 0}</Text>
              }
              align="right"
              canCopy={false}
            />
            <LabeledValueRow
              label="Local only files"
              value={
                <Text style={styles.valueText}>{localOnlyCount.data ?? 0}</Text>
              }
              align="right"
              canCopy={false}
            />
            <LabeledValueRow
              label="Lost files"
              value={
                <Text style={styles.valueText}>{lostCount.data ?? 0}</Text>
              }
              align="right"
              canCopy={false}
            />
          </InfoCard>
        </RowGroup>
      </View>
    </ActionSheet>
  )
}

const styles = StyleSheet.create({
  sheetContent: {
    paddingTop: 16,
    paddingBottom: 48,
    paddingHorizontal: 12,
  },
  sheetInnerDark: {
    gap: 14,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetTitle: {
    color: palette.gray[50],
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  groupSpacing: { marginTop: 8 },
  groupIndicator: { color: palette.gray[300], fontSize: 12, fontWeight: '700' },
  valueRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-end',
    width: '100%',
    flex: 1,
  },
  valueText: { color: palette.gray[100] },
  valuePercent: { color: palette.gray[400] },
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
