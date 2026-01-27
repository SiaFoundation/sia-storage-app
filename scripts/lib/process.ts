/**
 * Unified Process Runner
 *
 * Single abstraction for spawning processes with streaming output,
 * progress updates, and log file writing.
 */

import type { BuildTarget } from '../buildCache'
import { appendBuildLog } from '../buildCache'
import { ProgressIndicator } from '../progress'

export interface RunProcessOptions {
  /** Command and arguments to execute */
  command: string[]
  /** Working directory */
  cwd: string
  /** Build target for logging */
  target: BuildTarget
  /** Label for progress indicator */
  label: string
  /** Optional callback for each output chunk */
  onChunk?: (chunk: string) => void
}

export interface ProcessResult {
  success: boolean
  exitCode: number
  output: string
}

/**
 * Run a process with streaming output to log file and progress updates.
 *
 * This replaces the duplicated streaming loops in buildIosSim, buildIosDevice,
 * and buildAndroid. The process output is:
 * 1. Streamed to the build log file
 * 2. Used to update the progress indicator phase
 * 3. Accumulated for error detection
 */
export async function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const { command, cwd, target, label, onChunk } = options

  const progress = new ProgressIndicator()
  progress.start(label)

  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let output = ''
  const decoder = new TextDecoder()

  // Stream stdout
  const stdoutReader = proc.stdout.getReader()
  const stderrReader = proc.stderr.getReader()

  // Read both streams concurrently
  const readStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    isStderr = false
  ) => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      output += chunk
      appendBuildLog(target, chunk)
      progress.updatePhase(chunk)
      onChunk?.(chunk)
    }
  }

  await Promise.all([readStream(stdoutReader), readStream(stderrReader, true)])

  const exitCode = await proc.exited

  // Check for failure - non-zero exit code OR "BUILD FAILED" in output
  const hasBuildFailed = output.includes('BUILD FAILED')
  const success = exitCode === 0 && !hasBuildFailed

  progress.stop(success)

  return { success, exitCode, output }
}

/**
 * Run a simple command and return its output.
 * For commands that don't need streaming/progress.
 */
export async function runSimpleCommand(
  command: string[],
  options: { cwd?: string } = {}
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  return {
    success: exitCode === 0,
    stdout,
    stderr,
  }
}
