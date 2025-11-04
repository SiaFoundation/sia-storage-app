import { View, Text, StyleSheet } from 'react-native'
import ActionSheet from './ActionSheet'
import { InfoCard } from './InfoCard'
import { RowGroup } from './Group'
import { LabeledValueRow } from './LabeledValueRow'
import { palette } from '../styles/colors'
import { useIsConnected } from '../stores/sdk'
import { useIsOnline } from '../hooks/useIsOnline'
import { useUploadScannerStatus } from '../managers/uploadScanner'
import { closeSheet, useSheetOpen } from '../stores/sheets'

export function LibraryStatusSheet() {
  const isConnected = useIsConnected()
  const isOnline = useIsOnline()
  const uploadsProgress = useUploadScannerStatus()

  const uploadedCount = Math.max(
    0,
    (uploadsProgress.total ?? 0) - (uploadsProgress.remaining ?? 0)
  )

  const isOpen = useSheetOpen('libraryStatus')

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

        <RowGroup
          title="Uploads"
          style={styles.groupSpacing}
          indicator={
            <Text style={styles.groupIndicator}>
              {uploadsProgress.percentComplete}
            </Text>
          }
        >
          <InfoCard>
            <LabeledValueRow
              label="Uploaded"
              value={`${uploadedCount} / ${uploadsProgress.total}`}
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
    backgroundColor: palette.gray[950],
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
    flex: 1,
  },
  valueText: { color: palette.gray[100] },
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

export default LibraryStatusSheet
