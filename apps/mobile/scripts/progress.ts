/**
 * Progress Indicator for Build Scripts
 *
 * Displays animated spinner with elapsed time and build phase detection.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

export function detectBuildPhase(output: string): string {
  if (output.includes('Linking ')) return 'Linking'
  if (output.includes('Ld ')) return 'Linking'
  if (output.includes('CompileC ')) return 'Compiling C'
  if (output.includes('CompileSwift ')) return 'Compiling Swift'
  if (output.includes('Compiling ')) return 'Compiling'
  if (output.includes('ProcessInfoPlistFile')) return 'Processing Info.plist'
  if (output.includes('CopySwiftLibs')) return 'Copying Swift libs'
  if (output.includes('CodeSign ')) return 'Code signing'
  if (output.includes('PhaseScriptExecution')) return 'Running scripts'
  if (output.includes(':assembleDebug')) return 'Assembling APK'
  if (output.includes(':compileDebug')) return 'Compiling'
  if (output.includes(':merge')) return 'Merging resources'
  if (output.includes(':package')) return 'Packaging'
  if (output.includes('BUILD SUCCESSFUL')) return 'Complete'
  if (output.includes('** BUILD SUCCEEDED **')) return 'Complete'
  return 'Building'
}

export class ProgressIndicator {
  private frameIndex = 0
  private startTime = Date.now()
  private interval: ReturnType<typeof setInterval> | null = null
  private currentPhase = 'Building'
  private label = ''
  private estimatedDurationMs: number | null = null

  start(label: string, estimatedDurationMs?: number | null): void {
    this.label = label
    this.startTime = Date.now()
    this.frameIndex = 0
    this.currentPhase = 'Building'
    this.estimatedDurationMs = estimatedDurationMs ?? null
    this.render()
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length
      this.render()
    }, 80)
  }

  updatePhase(output: string): void {
    const phase = detectBuildPhase(output)
    if (phase !== this.currentPhase) {
      this.currentPhase = phase
    }
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime
  }

  private render(): void {
    const elapsedMs = Date.now() - this.startTime
    const elapsed = formatElapsed(elapsedMs)
    const spinner = SPINNER_FRAMES[this.frameIndex]

    let timeInfo = elapsed
    if (this.estimatedDurationMs !== null) {
      const percent = Math.min(99, Math.round((elapsedMs / this.estimatedDurationMs) * 100))
      const remaining = Math.max(0, this.estimatedDurationMs - elapsedMs)
      const remainingStr = formatElapsed(remaining)
      timeInfo = `${elapsed} / ~${formatElapsed(this.estimatedDurationMs)} (${percent}%, ~${remainingStr} left)`
    }

    // \x1b[K clears from cursor to end of line (prevents leftover characters)
    process.stdout.write(`\r\x1b[K${spinner} ${this.label} [${this.currentPhase}] ${timeInfo}`)
  }

  stop(success: boolean): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    const elapsed = formatElapsed(Date.now() - this.startTime)
    const icon = success ? '✓' : '✗'
    process.stdout.write(`\r\x1b[K${icon} ${this.label} (${elapsed})\n`)
  }
}
