import { useInputValue } from '../hooks/useInputValue'
import { setMaxDownloads, useMaxDownloads } from '../managers/downloadsPool'
import { cancelAllDownloads, useDownloadCounts } from '../stores/downloads'
import { cancelAllUploads, useUploadCounts } from '../stores/uploads'
import { Button } from './Button'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { InputRow } from './InputRow'
import { LabeledValueRow } from './LabeledValueRow'

export function SettingsAdvancedTransfers() {
  const uploadCounts = useUploadCounts()
  const downloadCounts = useDownloadCounts()
  const maxDownloads = useMaxDownloads()

  const maxDownloadsInputProps = useInputValue({
    value: String(maxDownloads.data),
    save: (text) => {
      const n = Number(text.replace(/[^0-9]/g, ''))
      if (Number.isFinite(n) && n > 0) setMaxDownloads(n)
    },
  })

  return (
    <>
      <RowGroup title="Uploads">
        <InfoCard>
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
    </>
  )
}
