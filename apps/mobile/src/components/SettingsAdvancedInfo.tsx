import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useShowAdvanced } from '@siastorage/core/stores'
import { Alert } from 'react-native'
import { humanSize } from '../lib/humanSize'
import { runFsEvictionScanner } from '../managers/fsEvictionScanner'
import { runFsOrphanScanner } from '../managers/fsOrphanScanner'
import type { MenuStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { InsetGroupLink, InsetGroupSection, InsetGroupToggleRow } from './InsetGroup'

type Props = NativeStackScreenProps<MenuStackParamList, 'Advanced'>

export function SettingsAdvancedInfo(_props: Props) {
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
              const before = await app().fs.calcTotalSize()
              await runFsOrphanScanner({ force: true })
              await runFsEvictionScanner({ force: true })
              const after = await app().fs.calcTotalSize()
              const freed = Math.max(0, before - after)
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
      <InsetGroupSection
        header="Debugging"
        footer="Shows extra technical details like file IDs, hashes, and URIs on file info screens."
      >
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
