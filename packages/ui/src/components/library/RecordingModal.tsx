import { useCallback, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'

type RecordingModalProps = {
  type: 'screen' | 'audio'
  onSave: (blob: Blob, name: string) => void
  onCancel: () => void
}

export function RecordingModal({
  type,
  onSave,
  onCancel,
}: RecordingModalProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle')
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      let stream: MediaStream
      if (type === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }

      streamRef.current = stream
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = () => {
        const recorded = new Blob(chunks, { type: recorder.mimeType })
        setBlob(recorded)
        setState('done')
        if (timerRef.current) clearInterval(timerRef.current)
      }

      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (recorder.state === 'recording') {
            recorder.stop()
          }
        }
      })

      recorder.start()
      setState('recording')
      setDuration(0)
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recording')
    }
  }, [type])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const handleSave = useCallback(() => {
    if (!blob) return
    const ext = 'webm'
    const prefix = type === 'screen' ? 'screen-recording' : 'audio-recording'
    const name = `${prefix}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`
    onSave(blob, name)
  }, [blob, type, onSave])

  const handleClose = useCallback(() => {
    stopRecording()
    onCancel()
  }, [stopRecording, onCancel])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <Dialog open onClose={handleClose}>
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-[13px] font-medium text-neutral-100 mb-4">
          {type === 'screen' ? 'Screen Recording' : 'Audio Recording'}
        </h2>

        {error && <p className="text-[13px] text-red-400 mb-3">{error}</p>}

        <div className="text-center py-6">
          {state === 'idle' && (
            <button
              type="button"
              onClick={startRecording}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center mx-auto transition-colors"
            >
              <div className="w-5 h-5 rounded-full bg-white" />
            </button>
          )}

          {state === 'recording' && (
            <>
              <p className="text-xl font-mono text-neutral-200 mb-4">
                {formatTime(duration)}
              </p>
              <button
                type="button"
                onClick={stopRecording}
                className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center mx-auto transition-colors"
              >
                <div className="w-5 h-5 rounded-sm bg-white" />
              </button>
            </>
          )}

          {state === 'done' && (
            <>
              <p className="text-[13px] text-neutral-400 mb-3">
                Recording complete ({formatTime(duration)})
              </p>
              {blob && type === 'audio' && (
                <audio
                  src={URL.createObjectURL(blob)}
                  controls
                  className="w-full mb-3"
                >
                  <track kind="captions" />
                </audio>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 px-4 pb-3.5">
        <button
          type="button"
          onClick={handleClose}
          className="px-3 py-1.5 text-[13px] text-neutral-400 hover:text-neutral-200 rounded-md hover:bg-neutral-800 transition-colors"
        >
          Cancel
        </button>
        {state === 'done' && blob && (
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 text-[13px] font-medium bg-white hover:bg-neutral-200 text-neutral-900 rounded-md transition-colors"
          >
            Save
          </button>
        )}
      </div>
    </Dialog>
  )
}
