import { StyleSheet, Switch } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from '../stacks/types'
import { InfoCard } from '../components/InfoCard'
import { LabeledValueRow } from '../components/LabeledValueRow'
import { cancelAllUploads, useUploadCounts } from '../stores/uploads'
import { cancelAllDownloads, useDownloadCounts } from '../stores/downloads'
import { Button } from '../components/Button'
import { RowGroup } from '../components/Group'
import { InputRow } from '../components/InputRow'
import { useInputValue } from '../hooks/useInputValue'
import { SettingsLayout } from '../components/SettingsLayout'
import { colors } from '../styles/colors'
import { useSettingsHeader } from '../hooks/useSettingsHeader'
import { setMaxUploads, useMaxUploads } from '../managers/uploadsPool'
import { setMaxDownloads, useMaxDownloads } from '../managers/downloadsPool'
import {
  toggleAutoScanUploads,
  toggleAutoSyncDownEvents,
  useAutoScanUploads,
  useAutoSyncDownEvents,
} from '../stores/settings'
import {
  toggleAutoSyncNewPhotos,
  useAutoSyncNewPhotos,
} from '../managers/syncNewPhotos'
import {
  usePhotosArchiveCursor,
  restartPhotosArchiveCursor,
} from '../managers/syncPhotosArchive'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Sync'>

export function SettingsSyncScreen(_props: Props) {
  useSettingsHeader()
  const uploadCounts = useUploadCounts()
  const downloadCounts = useDownloadCounts()
  const autoScan = useAutoScanUploads()
  const maxUploads = useMaxUploads()
  const maxDownloads = useMaxDownloads()
  const autoSync = useAutoSyncDownEvents()
  const autoSyncNew = useAutoSyncNewPhotos()
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchiveInProgress = (photosArchiveCursor.data ?? 0) > 0

  const maxUploadsInputProps = useInputValue({
    value: String(maxUploads.data),
    save: (text) => {
      const n = Number(text.replace(/[^0-9]/g, ''))
      if (Number.isFinite(n) && n > 0) setMaxUploads(n)
    },
  })

  const maxDownloadsInputProps = useInputValue({
    value: String(maxDownloads.data),
    save: (text) => {
      const n = Number(text.replace(/[^0-9]/g, ''))
      if (Number.isFinite(n) && n > 0) setMaxDownloads(n)
    },
  })

  return (
    <SettingsLayout style={styles.container}>
      <RowGroup title="Sync">
        <InfoCard>
          <LabeledValueRow
            label="Automatically upload files to network"
            labelWidth={300}
            value={
              <Switch
                value={autoScan.data ?? false}
                onValueChange={toggleAutoScanUploads}
              />
            }
          />
          <LabeledValueRow
            label="Automatically sync with your other devices"
            labelWidth={300}
            value={
              <Switch
                value={autoSync.data ?? false}
                onValueChange={toggleAutoSyncDownEvents}
              />
            }
          />
        </InfoCard>
      </RowGroup>
      <RowGroup title="Photos">
        <InfoCard>
          <LabeledValueRow
            label="Automatically import new photos"
            labelWidth={300}
            value={
              <Switch
                value={autoSyncNew.data ?? false}
                onValueChange={toggleAutoSyncNewPhotos}
              />
            }
          />
        </InfoCard>
        <Button
          style={{ marginTop: 10 }}
          disabled={photosArchiveInProgress}
          onPress={() => {
            void restartPhotosArchiveCursor()
          }}
        >
          {photosArchiveInProgress
            ? 'Sync in progress'
            : 'Import photos library'}
        </Button>
      </RowGroup>
      <RowGroup title="Uploads">
        <InfoCard>
          <InputRow
            label="Max concurrent uploads"
            labelWidth={200}
            keyboardType="number-pad"
            {...maxUploadsInputProps}
          />
          <LabeledValueRow
            label="Queued"
            value={String(uploadCounts.totalQueued)}
            canCopy={false}
          />
          <LabeledValueRow
            label="Active"
            value={String(uploadCounts.totalActive)}
            canCopy={false}
          />
        </InfoCard>
        <Button
          style={{ marginTop: 10 }}
          disabled={uploadCounts.total === 0}
          onPress={() => {
            cancelAllUploads()
          }}
        >
          Cancel uploads
        </Button>
      </RowGroup>

      <RowGroup title="Downloads">
        <InfoCard>
          <InputRow
            label="Max concurrent downloads"
            labelWidth={200}
            keyboardType="number-pad"
            {...maxDownloadsInputProps}
          />
          <LabeledValueRow
            label="Queued"
            value={String(downloadCounts.totalQueued)}
            canCopy={false}
          />
          <LabeledValueRow
            label="Active"
            value={String(downloadCounts.totalActive)}
            canCopy={false}
          />
        </InfoCard>
        <Button
          style={{ marginTop: 10 }}
          disabled={downloadCounts.total === 0}
          onPress={() => {
            cancelAllDownloads()
          }}
        >
          Cancel downloads
        </Button>
      </RowGroup>
    </SettingsLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 24,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowLabel: {
    color: colors.textTitleDark,
  },
})
