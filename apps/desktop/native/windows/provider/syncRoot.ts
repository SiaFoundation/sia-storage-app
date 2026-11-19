/*
 * Registering the library's folder with Windows as a cloud storage provider's
 * sync root, and taking it away.
 *
 * `StorageProviderSyncRootManager` registers the folder as a sync root and
 * with File Explorer, which then lists it in its navigation pane under the
 * app's name and icon, draws each file's cloud or tick, and offers "Always
 * keep on this device" and "Free up space" in its menu. The manager is a
 * Windows Runtime class, which Bun's FFI cannot call and Windows PowerShell,
 * part of every install, can, so each call here is a short script.
 * The provider registers at every start, over the registration an earlier
 * start left with the same id.
 */

/** Windows names a sync root `<provider>!<the user's SID>!<account>`. */
const SYNC_ROOT_ID = `
$ErrorActionPreference = 'Stop'
$manager = [Windows.Storage.Provider.StorageProviderSyncRootManager, Windows.Storage.Provider, ContentType = WindowsRuntime]
$id = "SiaStorage!$([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)!$env:SIA_MOUNT_ID"
`

// `GetFolderFromPathAsync` is a Windows Runtime operation, which PowerShell
// can only wait on as a .NET task. The policies are the ones `folder.ts` is
// written to: a read fetches the whole file, the system may dehydrate a file
// in sync on its own, and every placeholder comes from the provider.
const REGISTER = `${SYNC_ROOT_ID}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' }
$folder = [Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]::GetFolderFromPathAsync($env:SIA_SYNC_ROOT)
$info = New-Object Windows.Storage.Provider.StorageProviderSyncRootInfo
$info.Id = $id
$info.Path = $asTask.MakeGenericMethod([Windows.Storage.StorageFolder]).Invoke($null, @($folder)).Result
$info.DisplayNameResource = $env:SIA_DISPLAY_NAME
$info.IconResource = $env:SIA_ICON
$info.Version = '1'
$info.HydrationPolicy = 'Full'
$info.HydrationPolicyModifier = 'AutoDehydrationAllowed'
$info.PopulationPolicy = 'AlwaysFull'
$info.AllowPinning = $true
$info.Context = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer([Text.Encoding]::UTF8.GetBytes($id))
$manager::Register($info)
`

/** The exit code of `REGISTERED` for a sync root that is not. */
const NOT_REGISTERED = 3

// Asking for a sync root that is not registered throws.
const REGISTERED = `${SYNC_ROOT_ID}
try { [void]$manager::GetSyncRootInformationForId($id) } catch { exit ${NOT_REGISTERED} }
`

const UNREGISTER = `${SYNC_ROOT_ID}
$manager::Unregister($id)
`

/** Runs a script and returns its exit code, 0 or `NOT_REGISTERED`. Throws on any other. */
function run(script: string, env: Record<string, string>): number {
  const result = Bun.spawnSync(
    [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      // Base64, which nothing between here and PowerShell quotes again.
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { env: { ...process.env, ...env }, windowsHide: true },
  )
  if (result.exitCode !== 0 && result.exitCode !== NOT_REGISTERED) {
    throw new Error(`PowerShell exited with ${result.exitCode}: ${result.stderr.toString().trim()}`)
  }
  return result.exitCode
}

/** Registers `root`, an existing folder, as the sync root of the mount `mountId`. */
export function registerSyncRoot(root: string, mountId: string, name: string, icon: string): void {
  run(REGISTER, {
    SIA_MOUNT_ID: mountId,
    SIA_SYNC_ROOT: root,
    SIA_DISPLAY_NAME: name,
    SIA_ICON: icon,
  })
}

export function syncRootRegistered(mountId: string): boolean {
  return run(REGISTERED, { SIA_MOUNT_ID: mountId }) === 0
}

/** Takes the mount's registered folder out of File Explorer. Its files stay on disk. */
export function unregisterSyncRoot(mountId: string): void {
  run(UNREGISTER, { SIA_MOUNT_ID: mountId })
}
