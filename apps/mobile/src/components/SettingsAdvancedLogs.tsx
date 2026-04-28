import { getRemoteLogToken, setRemoteLogConfig } from '@siastorage/core/services/logForwarder'
import { useRemoteLogEnabled, useRemoteLogEndpoint } from '@siastorage/core/stores'
import { flushLogs, logger } from '@siastorage/logger'
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useToast } from '../lib/toastContext'
import {
  InsetGroupInputRow,
  InsetGroupLink,
  InsetGroupSection,
  InsetGroupToggleRow,
} from './InsetGroup'

type Props = {
  onViewLogs: () => void
}

function isValidEndpoint(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function SettingsAdvancedLogs({ onViewLogs }: Props) {
  const enabled = useRemoteLogEnabled()
  const endpoint = useRemoteLogEndpoint()
  const toast = useToast()

  const [endpointDraft, setEndpointDraft] = useState<string>('')
  const [tokenDraft, setTokenDraft] = useState<string>('')

  useEffect(() => {
    if (endpoint.data !== undefined) setEndpointDraft(endpoint.data)
  }, [endpoint.data])

  useEffect(() => {
    let active = true
    getRemoteLogToken().then((value) => {
      if (active) setTokenDraft(value ?? '')
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <>
      <InsetGroupSection header="Logs">
        <InsetGroupLink label="View logs" onPress={onViewLogs} />
      </InsetGroupSection>
      <InsetGroupSection footer="When enabled, every log entry is also sent as NDJSON to your endpoint. Compatible with any HTTP receiver that accepts application/x-ndjson.">
        <InsetGroupToggleRow
          label="Forward logs to endpoint"
          value={enabled.data ?? false}
          onValueChange={(v) => setRemoteLogConfig({ enabled: v })}
        />
        <InsetGroupInputRow
          label="Endpoint URL"
          value={endpointDraft}
          placeholder="https://logs.example.com/ingest"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setEndpointDraft}
          onBlur={() => {
            const next = endpointDraft.trim()
            if (next === (endpoint.data ?? '')) return
            if (!isValidEndpoint(next)) {
              Alert.alert('Invalid URL', 'Enter a valid http(s) URL or leave the field blank.')
              setEndpointDraft(endpoint.data ?? '')
              return
            }
            setRemoteLogConfig({ endpoint: next })
          }}
        />
        <InsetGroupInputRow
          label="Bearer token"
          value={tokenDraft}
          placeholder="Optional"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setTokenDraft}
          onBlur={() => {
            const next = tokenDraft.trim()
            setRemoteLogConfig({ token: next === '' ? null : next })
          }}
        />
        <InsetGroupLink
          label="Send test log"
          showChevron={false}
          onPress={() => {
            logger.info('remoteLog', 'test', { source: 'settings' })
            flushLogs()
            toast.show('Sent test log')
          }}
        />
      </InsetGroupSection>
    </>
  )
}
