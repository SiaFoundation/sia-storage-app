import { uint8ToHex } from '@siastorage/core'
import type { SdkBuilder } from '@siastorage/core/stores'
import { useState } from 'react'
import { useAuth } from '../../context/auth'
import { useAuthStore } from '../../stores/auth'

export function RecoveryScreen({
  builder,
}: {
  builder: React.RefObject<SdkBuilder | null>
}) {
  const auth = useAuth()
  const { setStoredKeyHex, setError } = useAuthStore()
  const [mode, setMode] = useState<'choose' | 'generate' | 'import'>('choose')
  const [phrase, setPhrase] = useState('')
  const [generatedPhrase, setGeneratedPhrase] = useState('')
  const [loading, setLoading] = useState(false)
  const [phraseError, setPhraseError] = useState<string | null>(null)

  async function handleGenerate() {
    const mnemonic = await auth.generateRecoveryPhrase()
    setGeneratedPhrase(mnemonic)
    setPhrase(mnemonic)
    setMode('generate')
  }

  async function handleValidatePhrase(value: string) {
    setPhrase(value)
    setPhraseError(null)
    if (value.trim()) {
      try {
        await auth.validateRecoveryPhrase(value.trim())
      } catch {
        setPhraseError('Invalid recovery phrase')
      }
    }
  }

  async function handleRegister() {
    const b = builder.current
    if (!b) {
      setError('No builder instance')
      return
    }

    const mnemonic = phrase.trim()
    try {
      await auth.validateRecoveryPhrase(mnemonic)
    } catch {
      setPhraseError('Invalid recovery phrase')
      return
    }

    setLoading(true)
    try {
      const registration = await b.register(mnemonic)
      const appKey = registration.appKey()
      const exported = appKey.export()
      const keyHex = uint8ToHex(exported)
      setStoredKeyHex(keyHex)
      const { indexerUrl } = useAuthStore.getState()
      await auth.onConnected(keyHex, indexerUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'choose') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-white">
              Recovery Phrase
            </h1>
            <p className="text-neutral-400 text-sm">
              Generate a new recovery phrase or enter an existing one.
            </p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGenerate}
              className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
            >
              Generate New Phrase
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-medium rounded-lg transition-colors"
            >
              Enter Existing Phrase
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-white">
            {mode === 'generate'
              ? 'Save Your Recovery Phrase'
              : 'Enter Recovery Phrase'}
          </h1>
          <p className="text-neutral-400 text-sm">
            {mode === 'generate'
              ? "Write down these 12 words in order. You'll need them to recover your account."
              : 'Enter your 12-word recovery phrase.'}
          </p>
        </div>

        {mode === 'generate' ? (
          <div className="grid grid-cols-3 gap-2 p-4 bg-neutral-900 rounded-lg border border-neutral-700">
            {generatedPhrase.split(' ').map((word, i) => (
              <div
                key={`${word}-${i}`}
                className="text-center py-2 bg-neutral-800 rounded text-sm"
              >
                <span className="text-neutral-500 mr-1">{i + 1}.</span>
                <span className="text-white">{word}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={phrase}
              onChange={(e) => handleValidatePhrase(e.target.value)}
              placeholder="Enter your 12-word recovery phrase..."
              rows={3}
              className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-green-500"
            />
            {phraseError && (
              <p className="text-red-400 text-sm">{phraseError}</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleRegister}
          disabled={loading || !phrase.trim()}
          className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Registering...' : 'Complete Setup'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('choose')
            setPhrase('')
            setGeneratedPhrase('')
            setPhraseError(null)
          }}
          className="w-full py-2 text-neutral-400 hover:text-neutral-300 text-sm transition-colors"
        >
          Back
        </button>
      </div>
    </div>
  )
}
