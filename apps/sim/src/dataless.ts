/**
 * Lets this process open files in a File Provider folder that macOS has not
 * downloaded yet, and every process it starts after.
 *
 * Opening a cloud-only ("dataless") file makes the kernel ask fileproviderd
 * for its bytes, but only when the opening process has dataless-file
 * materialization on. A launchd job has it off unless its plist sets
 * `MaterializeDatalessFiles`, and every process under it inherits that. So
 * when sim runs under an app or tool that launchd started as a background job,
 * a desktop scenario reading or writing a file in the Finder folder fails at
 * once with EDEADLK ("resource deadlock avoided"), and the File Provider
 * extension is never asked for the file. A shell in Terminal, or an app opened
 * from Finder or the Dock, has it on, which is why the same run passes there.
 *
 * The policy is per process and inherited by children spawned after it is set,
 * so it is set where a desktop device is created and before `attest macos`
 * starts its run.
 */
import { dlopen, FFIType } from 'bun:ffi'

// From the macOS SDK's sys/resource.h.
const IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES = 3
const IOPOL_SCOPE_PROCESS = 0
const IOPOL_MATERIALIZE_DATALESS_FILES_ON = 2

/**
 * Turns materialization on for this process and returns the policy it had
 * before: 0 default, 1 off, 2 on. Returns null off macOS, where there is
 * nothing to change. A refusal only warns, since a scenario that never opens
 * a cloud-only file still passes without it.
 */
export function allowDatalessDownloads(): number | null {
  if (process.platform !== 'darwin') return null
  const lib = dlopen('/usr/lib/libSystem.B.dylib', {
    getiopolicy_np: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    setiopolicy_np: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  })
  try {
    const before = lib.symbols.getiopolicy_np(
      IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
      IOPOL_SCOPE_PROCESS,
    )
    if (before === IOPOL_MATERIALIZE_DATALESS_FILES_ON) return before
    const failed = lib.symbols.setiopolicy_np(
      IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
      IOPOL_SCOPE_PROCESS,
      IOPOL_MATERIALIZE_DATALESS_FILES_ON,
    )
    if (failed !== 0) {
      console.error(
        'setiopolicy_np refused to let this process download cloud-only files, so opening one in the Finder folder will fail with EDEADLK',
      )
    }
    return before
  } finally {
    lib.close()
  }
}
