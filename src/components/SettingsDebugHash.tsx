import { StyleSheet, Text, View, ActivityIndicator } from 'react-native'
import { useState } from 'react'
import RNFS from 'react-native-fs'
import { Buffer } from 'buffer'
import { colors, palette } from '../styles/colors'
import { GroupTitle } from './Group'
import { InfoCard } from './InfoCard'
import { Button } from './Button'
import { rnfsHash, quickcryptoHash } from '../lib/contentHash'

/**
 * Hash testing component for debugging and E2E testing.
 *
 * This component provides a UI for testing native hashing implementations
 * (RNFS.hash() and QuickCrypto) on real devices. This is essential because:
 * - Unit tests cannot test native RNFS.hash() implementation (it's mocked)
 * - E2E tests can verify that native hashing works correctly on actual devices
 * - Allows comparison between RNFS.hash() and QuickCrypto fallback methods
 *
 * Test cases:
 * 1. Small file (30 characters): Tests basic hashing correctness
 * 2. Large file (10MB): Tests performance and streaming behavior
 */
type HashResult = {
  hash: string | null
  error?: string
  durationMs?: number
}

type TestState = 'idle' | 'running' | 'complete'

type TestCase = {
  dataDescription: string
  rnfs: { state: TestState; result: HashResult | null }
  quickCrypto: { state: TestState; result: HashResult | null }
}

function HashResultView({
  state,
  result,
  label,
}: {
  state: TestState
  result: HashResult | null
  label: string
}) {
  const formatDuration = (ms?: number) => {
    if (ms === undefined) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <View style={styles.resultColumn}>
      <View style={styles.resultHeader}>
        <Text style={styles.resultLabel}>{label}</Text>
        {state === 'running' && (
          <ActivityIndicator size="small" color={palette.blue[400]} />
        )}
      </View>
      {result?.hash ? (
        <>
          <Text
            style={styles.hashText}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {result.hash}
          </Text>
          <View style={styles.resultMeta}>
            <Text style={styles.successText}>✓</Text>
            <Text style={styles.durationText}>
              {formatDuration(result.durationMs)}
            </Text>
          </View>
        </>
      ) : result?.error ? (
        <>
          <Text style={styles.errorText} numberOfLines={2}>
            {result.error}
          </Text>
          <View style={styles.resultMeta}>
            <Text style={styles.failureText}>✗</Text>
            <Text style={styles.durationText}>
              {formatDuration(result.durationMs)}
            </Text>
          </View>
        </>
      ) : state === 'running' ? (
        <Text style={styles.pendingText}>Calculating...</Text>
      ) : (
        <Text style={styles.pendingText}>—</Text>
      )}
    </View>
  )
}

function TestCaseRow({ testCase }: { testCase: TestCase }) {
  const hashesMatch =
    testCase.rnfs.result?.hash &&
    testCase.quickCrypto.result?.hash &&
    testCase.rnfs.result.hash === testCase.quickCrypto.result.hash

  return (
    <View style={styles.testCaseRow}>
      <Text
        style={styles.dataDescription}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {testCase.dataDescription}
      </Text>
      <View style={styles.resultsRow}>
        <HashResultView
          state={testCase.rnfs.state}
          result={testCase.rnfs.result}
          label="RNFS"
        />
        <View style={styles.separator} />
        <HashResultView
          state={testCase.quickCrypto.state}
          result={testCase.quickCrypto.result}
          label="QuickCrypto"
        />
      </View>
      {testCase.rnfs.result?.hash && testCase.quickCrypto.result?.hash && (
        <Text
          style={[
            styles.matchText,
            hashesMatch ? styles.matchSuccess : styles.matchFailure,
          ]}
        >
          {hashesMatch ? '✓ Match' : '✗ Mismatch'}
        </Text>
      )}
    </View>
  )
}

export function SettingsDebugHash() {
  const [smallRnfsState, setSmallRnfsState] = useState<TestState>('idle')
  const [smallQuickCryptoState, setSmallQuickCryptoState] =
    useState<TestState>('idle')
  const [largeRnfsState, setLargeRnfsState] = useState<TestState>('idle')
  const [largeQuickCryptoState, setLargeQuickCryptoState] =
    useState<TestState>('idle')

  const [smallRnfsResult, setSmallRnfsResult] = useState<HashResult | null>(
    null
  )
  const [smallQuickCryptoResult, setSmallQuickCryptoResult] =
    useState<HashResult | null>(null)
  const [largeRnfsResult, setLargeRnfsResult] = useState<HashResult | null>(
    null
  )
  const [largeQuickCryptoResult, setLargeQuickCryptoResult] =
    useState<HashResult | null>(null)

  const handleRunSmallTest = async () => {
    setSmallRnfsState('running')
    setSmallQuickCryptoState('running')
    setSmallRnfsResult(null)
    setSmallQuickCryptoResult(null)

    let testFile: string | null = null
    let testDir: string | null = null

    try {
      testDir = `${RNFS.DocumentDirectoryPath}/hash-test`
      await RNFS.mkdir(testDir)
      testFile = `${testDir}/test.bin`
      // 30 bytes of zeros
      const testContent = Buffer.alloc(30, 0)
      await RNFS.writeFile(testFile, testContent.toString('base64'), 'base64')

      // Run both in parallel, updating state independently as each completes
      const rnfsPromise = (async () => {
        const start = Date.now()
        try {
          const hash = await rnfsHash(testFile!)
          setSmallRnfsResult({ hash, durationMs: Date.now() - start })
        } catch (error) {
          setSmallRnfsResult({
            hash: null,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - start,
          })
        } finally {
          setSmallRnfsState('complete')
        }
      })()

      const quickCryptoPromise = (async () => {
        const start = Date.now()
        try {
          const hash = await quickcryptoHash(testFile!)
          setSmallQuickCryptoResult({ hash, durationMs: Date.now() - start })
        } catch (error) {
          setSmallQuickCryptoResult({
            hash: null,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - start,
          })
        } finally {
          setSmallQuickCryptoState('complete')
        }
      })()

      // Wait for both to complete before cleanup
      await Promise.allSettled([rnfsPromise, quickCryptoPromise])
    } catch (error) {
      setSmallRnfsResult({
        hash: null,
        error: error instanceof Error ? error.message : String(error),
      })
      setSmallQuickCryptoResult({
        hash: null,
        error: error instanceof Error ? error.message : String(error),
      })
      setSmallRnfsState('complete')
      setSmallQuickCryptoState('complete')
    } finally {
      try {
        if (testFile) await RNFS.unlink(testFile)
        if (testDir) await RNFS.unlink(testDir)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  const handleRunLargeTest = async () => {
    setLargeRnfsState('running')
    setLargeQuickCryptoState('running')
    setLargeRnfsResult(null)
    setLargeQuickCryptoResult(null)

    let largeFile: string | null = null
    let testDir: string | null = null

    try {
      testDir = `${RNFS.DocumentDirectoryPath}/hash-test`
      await RNFS.mkdir(testDir)
      largeFile = `${testDir}/large.bin`
      const largeFileSizeBytes = 10 * 1024 * 1024 // 10MB
      // 10MB of zeros
      const largeContent = Buffer.alloc(largeFileSizeBytes, 0)
      await RNFS.writeFile(largeFile, largeContent.toString('base64'), 'base64')

      // Run both in parallel, updating state independently as each completes
      const rnfsPromise = (async () => {
        const hashStart = Date.now()
        try {
          const hash = await rnfsHash(largeFile!)
          setLargeRnfsResult({ hash, durationMs: Date.now() - hashStart })
        } catch (error) {
          setLargeRnfsResult({
            hash: null,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - hashStart,
          })
        } finally {
          setLargeRnfsState('complete')
        }
      })()

      const quickCryptoPromise = (async () => {
        const hashStart = Date.now()
        try {
          const hash = await quickcryptoHash(largeFile!)
          setLargeQuickCryptoResult({
            hash,
            durationMs: Date.now() - hashStart,
          })
        } catch (error) {
          setLargeQuickCryptoResult({
            hash: null,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - hashStart,
          })
        } finally {
          setLargeQuickCryptoState('complete')
        }
      })()

      // Wait for both to complete before cleanup
      await Promise.allSettled([rnfsPromise, quickCryptoPromise])
    } catch (error) {
      setLargeRnfsResult({
        hash: null,
        error: error instanceof Error ? error.message : String(error),
      })
      setLargeQuickCryptoResult({
        hash: null,
        error: error instanceof Error ? error.message : String(error),
      })
      setLargeRnfsState('complete')
      setLargeQuickCryptoState('complete')
    } finally {
      try {
        if (largeFile) await RNFS.unlink(largeFile)
        if (testDir) await RNFS.unlink(testDir)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  const smallTestCase: TestCase = {
    dataDescription: '30 bytes of 0s',
    rnfs: { state: smallRnfsState, result: smallRnfsResult },
    quickCrypto: {
      state: smallQuickCryptoState,
      result: smallQuickCryptoResult,
    },
  }

  const largeTestCase: TestCase = {
    dataDescription: '10 MB of 0s',
    rnfs: { state: largeRnfsState, result: largeRnfsResult },
    quickCrypto: {
      state: largeQuickCryptoState,
      result: largeQuickCryptoResult,
    },
  }

  const isSmallRunning =
    smallRnfsState === 'running' || smallQuickCryptoState === 'running'
  const isLargeRunning =
    largeRnfsState === 'running' || largeQuickCryptoState === 'running'

  return (
    <View style={styles.container}>
      <GroupTitle title="Sha256 Hash Testing" />
      <InfoCard>
        <Button
          onPress={handleRunSmallTest}
          disabled={isSmallRunning}
          variant="secondary"
        >
          {isSmallRunning ? 'Running...' : 'Test Small File'}
        </Button>
        <View style={styles.resultsContainer}>
          <TestCaseRow testCase={smallTestCase} />
        </View>
      </InfoCard>
      <InfoCard>
        <Button
          onPress={handleRunLargeTest}
          disabled={isLargeRunning}
          variant="secondary"
        >
          {isLargeRunning ? 'Running...' : 'Test Large File'}
        </Button>
        <View style={styles.resultsContainer}>
          <TestCaseRow testCase={largeTestCase} />
        </View>
      </InfoCard>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
  },
  resultsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.bgElevated,
  },
  testCaseRow: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.bgElevated,
  },
  dataDescription: {
    color: palette.gray[300],
    fontSize: 12,
    marginBottom: 10,
  },
  resultsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  resultColumn: {
    flex: 1,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  resultLabel: {
    color: palette.gray[100],
    fontSize: 12,
    fontWeight: '600',
  },
  hashText: {
    color: palette.gray[200],
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  successText: {
    color: palette.green[500],
    fontSize: 12,
    fontWeight: '600',
  },
  failureText: {
    color: palette.red[500],
    fontSize: 12,
    fontWeight: '600',
  },
  durationText: {
    color: palette.gray[400],
    fontSize: 11,
  },
  errorText: {
    color: palette.red[500],
    fontSize: 11,
    marginBottom: 4,
  },
  pendingText: {
    color: palette.gray[400],
    fontSize: 11,
    fontStyle: 'italic',
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgElevated,
  },
  matchText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  matchSuccess: {
    color: palette.green[500],
  },
  matchFailure: {
    color: palette.red[500],
  },
})
