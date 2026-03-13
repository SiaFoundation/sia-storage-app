import { APP_KEY } from '@siastorage/core/config'
import type { SdkBuilder } from '@siastorage/core/stores'
import { useState } from 'react'
import { useAuth } from '../../context/auth'
import { useAuthStore } from '../../stores/auth'

const APP_META = JSON.stringify({
  appID: APP_KEY,
  name: 'Sia Storage',
  description: 'Sia Storage Web App',
  serviceURL: 'https://sia.storage',
})

export function ConnectScreen({
  builder,
}: {
  builder: React.RefObject<SdkBuilder | null>
}) {
  const auth = useAuth()
  const { indexerUrl, setIndexerUrl, setStep, setError, setApprovalUrl } =
    useAuthStore()
  const [url, setUrl] = useState(indexerUrl || 'https://app.sia.storage')
  const [loading, setLoading] = useState(false)
  const [showCurl, setShowCurl] = useState(false)
  const [curlResponse, setCurlResponse] = useState('')

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const b = auth.createBuilder(url)
      builder.current = b
      setIndexerUrl(url)

      try {
        await b.requestConnection(APP_META)
        const approvalUrl = b.responseUrl()
        setApprovalUrl(approvalUrl)
        setStep('approve')
      } catch {
        setShowCurl(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setLoading(false)
    }
  }

  function handleCurlSubmit() {
    try {
      const b = builder.current
      if (!b) {
        setError('No builder instance')
        return
      }
      if (b.setConnectionResponse) {
        b.setConnectionResponse(APP_KEY, curlResponse)
      }
      const approvalUrl = b.responseUrl()
      setApprovalUrl(approvalUrl)
      setStep('approve')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid response')
    }
  }

  const curlCommand = `curl -X POST ${url}/auth/connect \\
  -H "Content-Type: application/json" \\
  -d '${APP_META}'`

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-white">
            Connect to Indexer
          </h1>
          <p className="text-neutral-400 text-sm">
            Enter your Sia indexer URL to get started
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://app.sia.storage"
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-green-500"
          />

          <button
            type="button"
            onClick={handleConnect}
            disabled={loading || !url}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </div>

        {showCurl && (
          <div className="space-y-4 p-4 bg-neutral-900 rounded-lg border border-neutral-700">
            <p className="text-sm text-neutral-300">
              Direct connection failed (CORS). Run this command and paste the
              response:
            </p>
            <pre className="text-xs bg-neutral-950 p-3 rounded overflow-x-auto text-green-400">
              {curlCommand}
            </pre>
            <textarea
              value={curlResponse}
              onChange={(e) => setCurlResponse(e.target.value)}
              placeholder="Paste the JSON response here..."
              rows={4}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-green-500 font-mono"
            />
            <button
              type="button"
              onClick={handleCurlSubmit}
              disabled={!curlResponse}
              className="w-full py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Submit Response
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
