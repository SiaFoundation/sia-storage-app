import { useDownloadCounts, useMaxDownloads } from '@siastorage/core/stores'
import { useInputValue } from '../hooks/useInputValue'
import { app } from '../stores/appService'
import { useUploadCounts } from '../stores/uploads'
import {
  InsetGroupInputRow,
  InsetGroupLink,
  InsetGroupSection,
  InsetGroupValueRow,
} from './InsetGroup'

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
      <InsetGroupSection header="Uploads">
        <InsetGroupValueRow label="Queued" value={String(uploadCounts.totalQueued)} />
        <InsetGroupValueRow label="Active" value={String(uploadCounts.totalActive)} />
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label="Cancel uploads"
          description="Stops all pending and in-progress uploads."
          destructive
          disabled={uploadCounts.total === 0}
          showChevron={false}
          onPress={async () => {
            await app().uploader.shutdown()
            app().uploads.clear()
          }}
        />
      </InsetGroupSection>
      <InsetGroupSection
        header="Downloads"
        footer="Higher values download faster but use more data and battery."
      >
        <InsetGroupInputRow
          label="Max concurrent downloads"
          keyboardType="number-pad"
          {...maxDownloadsInputProps}
        />
        <InsetGroupValueRow label="Queued" value={String(totalDownloadsQueued)} />
        <InsetGroupValueRow label="Active" value={String(totalDownloadsActive)} />
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label="Cancel downloads"
          description="Stops all pending and in-progress downloads."
          destructive
          disabled={totalDownloads === 0}
          showChevron={false}
          onPress={() => {
            app().downloads.cancelAll()
          }}
        />
      </InsetGroupSection>
    </>
  )
}
