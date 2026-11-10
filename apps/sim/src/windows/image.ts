/**
 * Builds the golden Windows image sim's Windows devices run on, from
 * Microsoft's Windows 11 ARM64 ISO: an unattended install, then the setup
 * below run as SYSTEM through Parallels Tools, then a snapshot named `golden`
 * that a run can revert to.
 *
 * What the setup gives the image, and why each is needed:
 * - `siatest` signed in at every boot with no lock screen, sleep, display
 *   timeout or screen saver, so a desktop session always exists for Electron,
 *   the tray and screenshots.
 * - OpenSSH Server with pwsh as its shell, for files, git and builds, which
 *   run as `siaadmin` for the reason `WindowsHost.ps` gives.
 * - A Dev Drive at `D:` for worktrees, `node_modules` and Bun's cache.
 *   `bun install` fails on a Parallels shared folder, so nothing builds from
 *   one.
 * - Bun at the version this Mac runs, x64, and Git and PowerShell 7, ARM64.
 * - The agent (agent.ts), started in the test account's session by a logon
 *   task, and a firewall rule for its port.
 * - Windows Update off, so a restart never lands in the middle of a run.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { waitFor } from '../wait'
import {
  ADMIN_USER,
  AGENT_PORT,
  credentials,
  GUEST,
  psQuote,
  sshKeyPath,
  TEST_USER,
  WindowsHost,
} from './host'
import { autounattend } from './unattend'
import type { ParallelsVm } from './vm'

/**
 * Exact versions, like every other dependency here. Bun is the x64 build, run
 * under Windows' x64 emulation, because `@siafoundation/sia-storage` loads its
 * native addon on import and publishes one for win32-x64 only, so the daemon
 * would not start under an ARM64 Bun. `bun install` run by it then picks the
 * x64 Electron, sharp and SDK packages too.
 */
const DOWNLOADS = {
  pwsh: 'https://github.com/PowerShell/PowerShell/releases/download/v7.6.9/PowerShell-7.6.9-win-arm64.msi',
  git: 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/Git-2.56.0.4-arm64.exe',
  bun: `https://github.com/oven-sh/bun/releases/download/bun-v${Bun.version}/bun-windows-x64.zip`,
  // The SDK's addon imports VCRUNTIME140.dll, and Windows on ARM ships no x64
  // copy. Microsoft publishes the redistributable only at this moving link.
  vcRedist: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
}

const PRL_TOOLS_ISO =
  '/Applications/Parallels Desktop.app/Contents/Resources/Tools/prl-tools-win-arm.iso'

/**
 * Runs a Windows PowerShell 5.1 script as SYSTEM, which works before SSH or
 * pwsh exist. The script goes in on stdin, since `prlctl exec` fails with
 * "Unable to open new session" once its arguments pass a few thousand
 * characters. It is read whole and run as one block, because PowerShell
 * reading commands from stdin runs each line as it arrives and splits a
 * block that spans lines.
 */
function systemPs(vm: ParallelsVm, script: string, what: string, timeoutMs = 1_800_000): string {
  // An uncaught error goes to stderr as CLIXML when no console is attached,
  // so it is caught and printed as text instead.
  const wrapped = `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
try {
${script}
} catch { Write-Output ($_ | Out-String); exit 1 }`
  const run = () =>
    vm.exec(
      [
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$s = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($s)); exit $LASTEXITCODE',
      ],
      timeoutMs,
      wrapped,
    )
  let out = run()
  // Parallels' guest channel sometimes fails a job with its own error, exit
  // 255 and a message naming one of its `Prl` calls, before or after the
  // script ran. Every step can run twice, so it gets one more try.
  if (out.exitCode === 255 && /\bPrl\w+:/.test(out.stderr + out.stdout)) out = run()
  if (out.exitCode !== 0) {
    throw new Error(
      `${what} failed (exit ${out.exitCode}): ${(out.stderr || out.stdout).trim().slice(-3000)}`,
    )
  }
  return out.stdout
}

/**
 * An ISO holding only the answer file, which Windows Setup finds on any
 * drive, in a folder of its own that the caller removes once Setup is done,
 * since the file holds both accounts' passwords.
 */
export function unattendIso(): { iso: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sia-sim-unattend-'))
  const content = join(dir, 'content')
  Bun.spawnSync(['mkdir', '-p', content])
  const { adminPassword, testPassword } = credentials()
  writeFileSync(
    join(content, 'autounattend.xml'),
    autounattend({ adminPassword, testPassword, computerName: 'SIA-SIM' }),
  )
  const iso = join(dir, 'unattend.iso')
  const out = Bun.spawnSync([
    'hdiutil',
    'makehybrid',
    '-iso',
    '-joliet',
    '-default-volume-name',
    'UNATTEND',
    '-o',
    iso,
    content,
  ])
  if (out.exitCode !== 0) throw new Error(`hdiutil failed: ${out.stderr.toString()}`)
  return { iso, dir }
}

export { PRL_TOOLS_ISO }

const POWER = String.raw`
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /setactive SCHEME_CURRENT
$c = Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue
if ($c -and $c.VolumeStatus -ne 'FullyDecrypted') { Disable-BitLocker -MountPoint C: | Out-Null }
reg add HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization /v NoLockScreen /t REG_DWORD /d 1 /f | Out-Null
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System /v InactivityTimeoutSecs /t REG_DWORD /d 0 /f | Out-Null
reg add HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU /v NoAutoUpdate /t REG_DWORD /d 1 /f | Out-Null
reg add HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f | Out-Null
$sid = (New-Object System.Security.Principal.NTAccount('siatest')).Translate([System.Security.Principal.SecurityIdentifier]).Value
if (-not (Test-Path "Registry::HKEY_USERS\$sid")) { throw 'siatest is not signed in, so its settings cannot be written' }
reg add "HKU\$sid\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f | Out-Null
reg add "HKU\$sid\Software\Policies\Microsoft\Windows\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f | Out-Null
`

/**
 * CD drives take the first free letters, `D:` among them, so they move to
 * the end of the alphabet before the Dev Drive takes `D:`.
 */
const DEV_DRIVE = String.raw`
$letter = [int][char]'R'
Get-CimInstance Win32_Volume -Filter 'DriveType=5' | ForEach-Object {
  Set-CimInstance -InputObject $_ -Property @{ DriveLetter = "$([char]$letter):" }
  $letter++
}
$vol = Get-Volume -DriveLetter D -ErrorAction SilentlyContinue
if (-not $vol) {
  $disk = Get-Disk | Where-Object PartitionStyle -eq 'RAW' | Select-Object -First 1
  if (-not $disk) { throw 'No empty disk for the Dev Drive' }
  Initialize-Disk -Number $disk.Number -PartitionStyle GPT
  New-Partition -DiskNumber $disk.Number -UseMaximumSize -DriveLetter D | Out-Null
  $vol = Get-Volume -DriveLetter D
}
if (-not $vol.FileSystem) {
  Format-Volume -DriveLetter D -DevDrive -NewFileSystemLabel SimDev -Confirm:$false -Force | Out-Null
}
`

const OPENSSH = String.raw`
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if ($cap.State -ne 'Installed') { Add-WindowsCapability -Online -Name $cap.Name | Out-Null }
Set-Service sshd -StartupType Automatic
Start-Service sshd
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Set-NetFirewallRule -Profile Any
`

const TOOLS = String.raw`
# Runs an installer and fails the step unless it succeeded, needs a restart
# (3010), or found the same or a newer version installed (1638).
function Install($file, $arguments) {
  $p = Start-Process $file -ArgumentList $arguments -Wait -PassThru
  if (@(0, 1638, 3010) -notcontains $p.ExitCode) { throw "$file exited with $($p.ExitCode)" }
}
$tmp = 'C:\sia-sim\downloads'
New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest ${psQuote(DOWNLOADS.pwsh)} -OutFile "$tmp\pwsh.msi" -UseBasicParsing
Install msiexec.exe @('/i', "$tmp\pwsh.msi", '/quiet', '/norestart', 'ADD_PATH=1')
Invoke-WebRequest ${psQuote(DOWNLOADS.git)} -OutFile "$tmp\git.exe" -UseBasicParsing
Install "$tmp\git.exe" @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES')
Invoke-WebRequest ${psQuote(DOWNLOADS.vcRedist)} -OutFile "$tmp\vc_redist.x64.exe" -UseBasicParsing
Install "$tmp\vc_redist.x64.exe" @('/install', '/quiet', '/norestart')
Invoke-WebRequest ${psQuote(DOWNLOADS.bun)} -OutFile "$tmp\bun.zip" -UseBasicParsing
Expand-Archive "$tmp\bun.zip" "$tmp\bun" -Force
New-Item -ItemType Directory -Force C:\Tools\bun | Out-Null
# Created under C:\, whose default lets any signed-in account write into a
# new folder. Bun and the installers run as an administrator, so only
# administrators may change them.
foreach ($d in 'C:\Tools', 'C:\sia-sim') {
  icacls $d /inheritance:r /grant 'Administrators:(OI)(CI)F' /grant 'SYSTEM:(OI)(CI)F' /grant 'Users:(OI)(CI)RX' | Out-Null
}
$newBun = (Get-ChildItem "$tmp\bun" -Recurse -Filter bun.exe | Select-Object -First 1).FullName
$oldBun = 'C:\Tools\bun\bun.exe'
if (-not (Test-Path $oldBun) -or (Get-FileHash $newBun).Hash -ne (Get-FileHash $oldBun).Hash) {
  # The agent and any app's daemon run on this binary, and Windows will not
  # replace a running one. An app still running would start its daemon again,
  # so it goes first. The restart at the end of setup starts the agent again.
  Get-Process electron, bun -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  Copy-Item $newBun $oldBun -Force
}
$path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($path -notlike '*C:\Tools\bun*') { [Environment]::SetEnvironmentVariable('Path', "$path;C:\Tools\bun", 'Machine') }
[Environment]::SetEnvironmentVariable('BUN_INSTALL_CACHE_DIR', 'D:\sia\bun-cache', 'Machine')
# node_modules nests past the 260-character path limit programs get otherwise.
reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f | Out-Null
$git = 'C:\Program Files\Git\cmd\git.exe'
& $git config --system core.autocrlf false
& $git config --system core.longpaths true
& $git config --system --add safe.directory '*'
New-Item -Path HKLM:\SOFTWARE\OpenSSH -Force | Out-Null
New-ItemProperty -Path HKLM:\SOFTWARE\OpenSSH -Name DefaultShell -Value 'C:\Program Files\PowerShell\7\pwsh.exe' -PropertyType String -Force | Out-Null
`

function access(publicKey: string, token: string, agentSource: string, macAddress: string): string {
  const agent64 = Buffer.from(agentSource).toString('base64')
  return String.raw`
# SSH logs in as the administrator only, for the reason WindowsHost.ps gives.
$pub = ${psQuote(publicKey)}
$admin = 'C:\ProgramData\ssh\administrators_authorized_keys'
[IO.File]::WriteAllText($admin, $pub + [Environment]::NewLine)
icacls $admin /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
foreach ($d in ${psQuote(GUEST.agentDir)}, ${psQuote(GUEST.incoming)}, 'D:\sia\worktrees', 'D:\sia\sessions', 'D:\sia\bun-cache') {
  New-Item -ItemType Directory -Force $d | Out-Null
}
# The administrator installs and builds the worktrees under D:\sia, so the
# test account, which the app runs as, may write only its sessions.
# Set as a whole, removing any grant of the test account's own, so a rerun
# leaves exactly these whatever the folder had.
icacls ${psQuote(GUEST.root)} /inheritance:r /remove:g siatest /grant 'Administrators:(OI)(CI)F' /grant 'SYSTEM:(OI)(CI)F' /grant 'Users:(OI)(CI)RX' | Out-Null
icacls 'D:\sia\sessions' /grant 'siatest:(OI)(CI)F' | Out-Null
# The token is assigned on a line of its own, which cannot fail, so an error
# on the line that writes it never prints it.
$token = ${psQuote(token)}
[IO.File]::WriteAllText(${psQuote(`${GUEST.agentDir}\\token`)}, $token)
[IO.File]::WriteAllBytes(${psQuote(`${GUEST.agentDir}\\agent.ts`)}, [Convert]::FromBase64String(${psQuote(agent64)}))
if (-not (Get-NetFirewallRule -DisplayName 'Sia sim agent' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Sia sim agent' -Direction Inbound -Protocol TCP -LocalPort ${AGENT_PORT} -Action Allow -Profile Any | Out-Null
}
# Only this Mac, on Parallels' shared network, reaches the agent.
Get-NetFirewallRule -DisplayName 'Sia sim agent' | Set-NetFirewallRule -RemoteAddress ${psQuote(macAddress)}
Add-MpPreference -ExclusionPath 'D:\sia', 'C:\Tools\bun', 'C:\sia-sim'
$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\conhost.exe' -Argument ${psQuote(`--headless ${GUEST.bun} ${GUEST.agentDir}\\agent.ts`)} -WorkingDirectory ${psQuote(GUEST.agentDir)}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User siatest
$principal = New-ScheduledTaskPrincipal -UserId siatest -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName SiaSimAgent -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
`
}

/** The setup steps, in order, each safe to run again on an image that has it. */
export function provisionSteps(macAddress: string): Array<{ name: string; script: string }> {
  const { agentToken } = credentials()
  const publicKey = readFileSync(`${sshKeyPath()}.pub`, 'utf8').trim()
  const agentSource = readFileSync(join(import.meta.dir, 'agent.ts'), 'utf8')
  return [
    { name: 'power and lock screen', script: POWER },
    { name: 'Dev Drive', script: DEV_DRIVE },
    { name: 'OpenSSH Server', script: OPENSSH },
    { name: 'PowerShell 7, Git and Bun', script: TOOLS },
    {
      name: 'SSH keys, folders, agent and its logon task',
      script: access(publicKey, agentToken, agentSource, macAddress),
    },
  ]
}

export async function provision(vm: ParallelsVm): Promise<void> {
  // Parallels Tools reconnect for a few seconds after a settings change, and
  // until then every exec fails with "Unable to open new session".
  await waitFor(
    'Parallels Tools to answer',
    () => vm.exec(['cmd.exe', '/c', 'exit 0'], 30_000).exitCode === 0,
    {
      timeoutMs: 120_000,
      intervalMs: 2000,
    },
  )
  for (const step of provisionSteps(await vm.hostAddress())) {
    const started = Date.now()
    systemPs(vm, step.script, step.name)
    console.log(`${step.name} done in ${Math.round((Date.now() - started) / 1000)}s`)
  }
  // sshd reads the machine PATH and DefaultShell when it starts, and the logon
  // task runs at the next sign-in, so a restart puts both in effect. SSH
  // answers for a while after the restart begins, and a copy to a VM that is
  // shutting down fails, so the wait is for Windows to report a new boot time.
  const bootTime = () =>
    vm
      .exec(
        [
          'powershell.exe',
          '-NoProfile',
          '-Command',
          '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.Ticks',
        ],
        30_000,
      )
      .stdout.trim()
  // Read until it answers, since a read that failed would make the first
  // good one afterwards look like a new boot.
  const before = await waitFor('the boot time', () => bootTime() || null, {
    timeoutMs: 60_000,
    intervalMs: 2000,
  })
  vm.exec(['shutdown.exe', '/r', '/t', '0'])
  await waitFor(
    'Windows to restart',
    () => {
      const now = bootTime()
      return now !== '' && now !== before
    },
    { timeoutMs: 300_000, intervalMs: 3000 },
  )
  const host = new WindowsHost(vm)
  await host.ready()
  await host.mustPs(
    `if (-not (Test-Path ${psQuote(GUEST.repo)})) { git init --bare --quiet ${psQuote(GUEST.repo)} }`,
    'Creating the repository',
  )
  const health = await host.agent<{ user: string }>('/health')
  if (health.user !== TEST_USER)
    throw new Error(`The agent runs as ${health.user}, not ${TEST_USER}`)
  console.log(`agent running as ${health.user}, SSH as ${ADMIN_USER}`)
}

/** Waits until Setup has finished and the test account is signed in with Parallels Tools running. */
export async function waitForInstall(vm: ParallelsVm, timeoutMs = 90 * 60_000): Promise<void> {
  await waitFor(
    'Windows to install and sign in siatest',
    () => {
      // `query user` exits 1 even when it lists sessions, so only its output counts.
      const out = vm.exec(['cmd.exe', '/c', 'query user'], 30_000)
      return /^\s*>?siatest\s/im.test(out.stdout)
    },
    { timeoutMs, intervalMs: 20_000 },
  )
}
