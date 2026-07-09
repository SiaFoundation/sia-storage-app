import { usePhotoImportDirectory } from '@siastorage/core/stores'
import { useCallback, useState } from 'react'
import { useMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import { toggleAutoSyncNewPhotos, useAutoSyncNewPhotos } from '../managers/syncNewPhotos'
import { useArchiveSyncCompletedAt } from '../managers/syncPhotosArchive'
import { app } from '../stores/appService'
import { useInProgressImport } from '../stores/imports'
import { openSheet } from '../stores/sheets'
import { ArchiveSyncModal } from './ArchiveSyncModal'
import { InsetGroupLink, InsetGroupSection, InsetGroupToggleRow } from './InsetGroup'
import { SelectDirectorySheet } from './SelectDirectorySheet'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const archiveCompletedAt = useArchiveSyncCompletedAt()
  const { isSomeAccess, accessLabel, manageAccess } = useMediaLibraryPermissions()
  const photoImportDir = usePhotoImportDirectory()
  const [modalVisible, setModalVisible] = useState(false)

  // Tapping "Import photo library" starts a new full walk, so the row is
  // disabled while a prior scan is still in progress, keeping a second scan
  // from stacking on an in-flight one. The "Import new photos" row only turns
  // the feature on or off (its internal poll keeps one open import per photo
  // source), so it is never locked.
  const libraryScanInProgress = useInProgressImport('library-scan')
  const libraryScanLocked = !!libraryScanInProgress.data

  const completedDateLabel = formatDisplayDate(archiveCompletedAt.data ?? 0)
  const photosFooter = 'Automatically import new photos taken on this device.'
  const importDescription = completedDateLabel
    ? `Imports every photo and video currently in your library. Last completed ${completedDateLabel}.`
    : 'Imports every photo and video currently in your library.'

  const handleOpenDirectoryPicker = useCallback(() => {
    openSheet('selectPhotoImportDirectory')
  }, [])

  const handleSelectDirectory = useCallback((name: string) => {
    void app().settings.setPhotoImportDirectory(name)
  }, [])

  const handleClearDirectory = useCallback(() => {
    void app().settings.setPhotoImportDirectory('')
  }, [])

  return (
    <>
      <InsetGroupSection header="Photos" footer={photosFooter}>
        <InsetGroupLink
          label="Photo access"
          value={accessLabel}
          onPress={manageAccess}
          showChevron={false}
        />
        <InsetGroupLink
          label="Import folder"
          value={photoImportDir.data || 'None'}
          onPress={handleOpenDirectoryPicker}
        />
        <InsetGroupToggleRow
          label="Import new photos"
          value={autoSyncNew.data ?? false}
          onValueChange={toggleAutoSyncNewPhotos}
        />
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label="Import photo library"
          description={
            libraryScanLocked ? 'A photo library import is already in progress.' : importDescription
          }
          onPress={() => setModalVisible(true)}
          disabled={!isSomeAccess || libraryScanLocked}
          showChevron={false}
        />
      </InsetGroupSection>
      <SelectDirectorySheet
        sheetName="selectPhotoImportDirectory"
        currentValue={photoImportDir.data ?? ''}
        onSelect={handleSelectDirectory}
        onClear={handleClearDirectory}
      />
      <ArchiveSyncModal visible={modalVisible} onRequestClose={() => setModalVisible(false)} />
    </>
  )
}

function formatDisplayDate(displayDate: number): string | null {
  if (displayDate <= 0) return null
  const d = new Date(displayDate)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d)
  } catch {
    return d.toDateString()
  }
}
