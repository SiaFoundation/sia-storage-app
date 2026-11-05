import { useShowAdvanced } from '@siastorage/core/stores'
import { Alert } from 'react-native'
import { humanSize } from '../lib/humanSize'
import { clearBackedUpFsFiles } from '../managers/fsEvictionScanner'
import { runFsOrphanScanner } from '../managers/fsOrphanScanner'
import { app } from '../stores/appService'
import { InsetGroupLink, InsetGroupSection, InsetGroupToggleRow } from './InsetGroup'

type Props = {
  onImport: () => void
}

export function SettingsAdvancedInfo({ onImport }: Props) {
  const showAdvanced = useShowAdvanced()

  const handleClearLocalFiles = async () => {
    const cached = await app().fs.calcTotalSize()
    Alert.alert(
      'Clear local files',
      `Removes up to ${humanSize(cached) ?? '0 B'} of files from this device. Files that aren't backed up yet are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              // Summed from both passes rather than read off the fs table
              // before and after, which misses the bytes of every orphan the
              // scan removes that had no fs row.
              const orphans = await runFsOrphanScanner({ force: true })
              const evicted = await clearBackedUpFsFiles()
              const freed = (orphans?.bytesFreed ?? 0) + (evicted?.bytesFreed ?? 0)
              Alert.alert('Local files cleared', `Freed ${humanSize(freed) ?? '0 B'}.`)
            } catch (e: unknown) {
              Alert.alert('Error', String(e))
            }
          },
        },
      ],
    )
  }

  return (
    <>
      <InsetGroupSection header="Debugging">
        <InsetGroupLink label="Import" onPress={onImport} />
      </InsetGroupSection>
      <InsetGroupSection footer="Shows extra technical details like file IDs, hashes, and URIs on file info screens.">
        <InsetGroupToggleRow
          label="Show advanced information"
          value={showAdvanced.data ?? false}
          onValueChange={(val) => app().settings.setShowAdvanced(val)}
        />
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label="Clear local files"
          description="Removes files on this device that are already backed up. Files that aren't backed up yet are kept."
          onPress={handleClearLocalFiles}
          showChevron={false}
          destructive
        />
      </InsetGroupSection>
    </>
  )
}
