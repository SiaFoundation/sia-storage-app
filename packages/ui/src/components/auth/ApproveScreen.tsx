import type { SdkBuilder } from '@siastorage/core/stores'
import { useState } from 'react'
import { useAuthStore } from '../../stores/auth'

export function ApproveScreen({
  builder,
}: {
  builder: React.RefObject<SdkBuilder | null>
}) {
  const { approvalUrl, setStep, setError } = useAuthStore()
  const [waiting, setWaiting] = useState(false)

  async function handleWaitForApproval() {
    const b = builder.current
    if (!b) {
      setError('No builder instance')
      return
    }

    setWaiting(true)
    try {
      await b.waitForApproval()
      setStep('recovery')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setWaiting(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-white">
            Approve Connection
          </h1>
          <p className="text-neutral-400 text-sm">
            Open the link below in a new tab to approve the connection, then
            click "Check Approval".
          </p>
        </div>

        {approvalUrl && (
          <a
            href={approvalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-3 bg-neutral-800 hover:bg-neutral-700 text-green-400 font-mono text-sm rounded-lg transition-colors break-all px-4"
          >
            {approvalUrl}
          </a>
        )}

        <button
          type="button"
          onClick={handleWaitForApproval}
          disabled={waiting}
          className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-medium rounded-lg transition-colors"
        >
          {waiting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-neutral-400 border-t-white rounded-full animate-spin" />
              Waiting for approval...
            </span>
          ) : (
            'Check Approval'
          )}
        </button>
      </div>
    </div>
  )
}
