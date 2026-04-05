import { useDownloadCounts, useMaxDownloads } from '@siastorage/core/stores'
import { useInputValue } from '../hooks/useInputValue'
import { app } from '../stores/appService'
import { useUploadCounts } from '../stores/uploads'
import { Button } from './Button'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { InputRow } from './InputRow'
import { LabeledValueRow } from './LabeledValueRow'

export function SettingsAdvancedTransfers() {
  const uploadCounts = useUploadCounts()
  const { data: downloadCounts } = useDownloadCounts()
  const maxDownloads = useMaxDownloads()

  const totalDownloads = downloadCounts?.total ?? 0
  const totalDownloadsActive = downloadCounts?.totalActive ?? 0
  const totalDownloadsQueued = downloadCounts?.totalQueued ?? 0

  const maxDownloadsInputProps = useInputValue({
    value: String(maxDownloads.data),
    save: (text) => {
      const n = Number(text.replace(/[^0-9]/g, ''))
      if (Number.isFinite(n) && n > 0) app().downloads.setMaxSlots(n)
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
          onPress={async () => {
            await app().uploader.shutdown()
            app().uploads.clear()
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
          <LabeledValueRow label="Queued" value={String(totalDownloadsQueued)} canCopy={false} />
          <LabeledValueRow label="Active" value={String(totalDownloadsActive)} canCopy={false} />
        </InfoCard>
        <Button
          style={{ marginTop: 10 }}
          disabled={totalDownloads === 0}
          onPress={() => {
            app().downloads.cancelAll()
          }}
        >
          Cancel downloads
        </Button>
      </RowGroup>
    </>
  )
}
