import { describe, expect, test } from 'bun:test'
import { appLogcat } from '../src/devices/android'
import { crashReason } from '../src/devices/ios'

const PKG = 'sia.storage.dev'

describe('appLogcat', () => {
  const dump = [
    '--------- beginning of main',
    '09-30 12:00:00.100   500   520 I ActivityManager: Start proc 4321:sia.storage.dev/u0a190 for next-top-activity {sia.storage.dev/.MainActivity}',
    '09-30 12:00:00.200   900   900 I Zygote  : unrelated system line',
    '09-30 12:00:01.000  4321  4321 I SoLoader: loading libhermes.so',
    '09-30 12:00:01.500  4321  4321 E AndroidRuntime: FATAL EXCEPTION: main',
    '09-30 12:00:01.500  4321  4321 E AndroidRuntime: Process: sia.storage.dev, PID: 4321',
    '09-30 12:00:01.500  4321  4321 E AndroidRuntime: java.lang.UnsatisfiedLinkError: couldn\'t find "libfoo.so"',
    '09-30 12:00:01.500  4321  4321 E AndroidRuntime: \tat com.facebook.soloader.SoLoader.load(SoLoader.java:1)',
    '09-30 12:00:02.000   500   540 I ActivityManager: Process sia.storage.dev (pid 4321) has died: fg TOP',
  ].join('\n')

  test("keeps the app's process lines, AndroidRuntime and lines naming the package", () => {
    const { lines } = appLogcat(dump, PKG)
    expect(lines.some((l) => l.includes('Zygote'))).toBe(false)
    expect(lines.some((l) => l.includes('Start proc 4321'))).toBe(true)
    expect(lines.some((l) => l.includes('libhermes.so'))).toBe(true)
    expect(lines.some((l) => l.includes('has died'))).toBe(true)
    expect(lines.filter((l) => l.includes('AndroidRuntime'))).toHaveLength(4)
  })

  test('the crash is the exception line after the Process line of FATAL EXCEPTION', () => {
    expect(appLogcat(dump, PKG).crash).toBe(
      'java.lang.UnsatisfiedLinkError: couldn\'t find "libfoo.so"',
    )
  })

  test("another app's Java crash is not the app's crash", () => {
    const other = [
      '09-30 12:00:01.500  7000  7000 E AndroidRuntime: FATAL EXCEPTION: main',
      '09-30 12:00:01.500  7000  7000 E AndroidRuntime: Process: com.other, PID: 7000',
      '09-30 12:00:01.500  7000  7000 E AndroidRuntime: java.lang.IllegalStateException: other',
    ].join('\n')
    expect(appLogcat(other, PKG).crash).toBeUndefined()
  })

  test('a native crash gives its Fatal signal line and the abort message', () => {
    const native = [
      '09-30 12:00:01.000  4321  4400 F libc    : Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 4400 (mqt_js), pid 4321 (sia.storage.dev)',
      "09-30 12:00:01.200  4500  4500 F DEBUG   : Abort message: 'terminating due to uncaught exception'",
    ].join('\n')
    expect(appLogcat(native, PKG).crash).toBe(
      "Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 4400 (mqt_js), pid 4321 (sia.storage.dev), Abort message: 'terminating due to uncaught exception'",
    )
  })

  test('a dump with nothing about the app gives no lines and no crash', () => {
    expect(appLogcat('09-30 12:00:00.200   900   900 I Zygote  : x', PKG)).toEqual({
      lines: [],
      crash: undefined,
    })
  })
})

describe('crashReason', () => {
  const header = '{"app_name":"SiaStorageDev","bug_type":"309"}'

  test('gives the exception type and signal and the termination reason', () => {
    const body = {
      exception: { type: 'EXC_BAD_ACCESS', signal: 'SIGSEGV' },
      termination: { indicator: 'Segmentation fault: 11' },
    }
    expect(crashReason(`${header}\n${JSON.stringify(body, null, 2)}`)).toBe(
      'EXC_BAD_ACCESS (SIGSEGV), Segmentation fault: 11',
    )
  })

  test("adds an uncaught exception's message", () => {
    const body = {
      exception: { type: 'EXC_CRASH', signal: 'SIGABRT' },
      termination: { indicator: 'Abort trap: 6' },
      exceptionReason: { composed_message: 'Unhandled JS Exception: boom' },
    }
    expect(crashReason(`${header}\n${JSON.stringify(body)}`)).toBe(
      'EXC_CRASH (SIGABRT), Abort trap: 6, Unhandled JS Exception: boom',
    )
  })

  test("names the crashed thread's top symbolicated frame", () => {
    const body = {
      exception: { type: 'EXC_BAD_ACCESS', signal: 'SIGSEGV' },
      faultingThread: 1,
      threads: [
        { frames: [{ symbol: 'mach_msg2_trap' }] },
        { frames: [{}, { symbol: 'vdbeSafety' }, { symbol: 'bindText' }] },
      ],
    }
    expect(crashReason(`${header}\n${JSON.stringify(body)}`)).toBe(
      'EXC_BAD_ACCESS (SIGSEGV), in vdbeSafety',
    )
  })

  test('a report that is not JSON gives nothing', () => {
    expect(crashReason('Process: SiaStorageDev\nException Type: EXC_CRASH')).toBeUndefined()
  })
})
