/**
 * Device Detection and Operations
 *
 * Reliable device detection using:
 * - iOS: xcrun devicectl with JSON output (replaces deprecated ios-deploy)
 * - Android: adb devices
 *
 * Supports both simulators/emulators and physical devices.
 */

import { $ } from 'bun'
import { runSimpleCommand } from './process'

export type Platform = 'ios' | 'android'
export type DeviceType = 'simulator' | 'device'

export interface Device {
  id: string
  name: string
  platform: Platform
  type: DeviceType
  state: 'available' | 'unavailable' | 'locked' | 'unknown'
}

interface DevicectlDevice {
  capabilities: Array<{ name: string; featureIdentifier?: string }>
  connectionProperties: {
    authenticationType?: string
    isMobileDeviceOnly?: boolean
    localHostnames?: string[]
    pairingState?: string
    potentialHostnames?: string[]
    transportType?: string
    tunnelIPAddress?: string
    tunnelState?: string
    usbProductId?: number
  }
  deviceProperties: {
    bootedFromSnapshot?: boolean
    bootedSnapshotName?: string
    ddiServicesAvailable?: boolean
    developerModeStatus?: string
    hasInternalOSBuild?: boolean
    name: string
    osBuildUpdate?: string
    osVersionNumber?: string
    rootFileSystemIsWritable?: boolean
  }
  hardwareProperties: {
    cpuType: { name: string; subType: number; type: number }
    deviceType: string
    ecid?: string
    hardwareModel?: string
    internalStorageCapacity?: number
    isProductionFused?: boolean
    marketingName?: string
    platform: string
    productType?: string
    reality?: string
    serialNumber?: string
    supportedCPUTypes?: Array<{ name: string; subType: number; type: number }>
    supportedDeviceFamilies?: number[]
    thinningProductType?: string
    udid: string
  }
  identifier: string
  visibilityClass: string
}

interface DevicectlOutput {
  info: {
    arguments: string[]
    commandType: string
    environment: Record<string, string>
    jsonVersion: number
    outcome: string
    version: string
  }
  result: {
    devices: DevicectlDevice[]
  }
}

/**
 * Parse devicectl JSON output to extract device list.
 * Exported for testing.
 */
export function parseDevicectlOutput(stdout: string): Device[] {
  // devicectl outputs both human-readable text AND JSON to stdout
  // Extract just the JSON portion starting from the first '{'
  const jsonStart = stdout.indexOf('{')
  if (jsonStart === -1) {
    return []
  }
  const jsonStr = stdout.slice(jsonStart)
  const data: DevicectlOutput = JSON.parse(jsonStr)

  return data.result.devices.map((d) => {
    // Determine device state
    let state: Device['state'] = 'unknown'
    if (d.connectionProperties.tunnelState === 'connected') {
      state = 'available'
    } else if (d.connectionProperties.pairingState === 'paired') {
      state = 'available'
    }

    return {
      id: d.identifier,
      name: d.deviceProperties.name,
      platform: 'ios' as Platform,
      type: 'device' as DeviceType,
      state,
    }
  })
}

/**
 * List all available iOS devices using devicectl JSON API.
 */
async function listIosDevices(): Promise<Device[]> {
  const result = await runSimpleCommand([
    'xcrun',
    'devicectl',
    'list',
    'devices',
    '--json-output',
    '/dev/stdout',
  ])

  if (!result.success) {
    console.error('Failed to list iOS devices:', result.stderr)
    return []
  }

  try {
    return parseDevicectlOutput(result.stdout)
  } catch (e) {
    console.error('Failed to parse devicectl output:', e)
    return []
  }
}

/**
 * Parse simctl JSON output to extract booted simulators.
 * Exported for testing.
 */
export function parseSimctlOutput(stdout: string): Device[] {
  const data = JSON.parse(stdout)
  const devices: Device[] = []

  for (const runtime in data.devices) {
    for (const device of data.devices[runtime]) {
      if (device.state === 'Booted') {
        devices.push({
          id: device.udid,
          name: device.name,
          platform: 'ios',
          type: 'simulator',
          state: 'available',
        })
      }
    }
  }

  return devices
}

/**
 * List all booted iOS simulators.
 */
async function listIosSimulators(): Promise<Device[]> {
  const result = await $`xcrun simctl list devices booted --json`
    .quiet()
    .nothrow()
  if (result.exitCode !== 0) {
    return []
  }

  try {
    return parseSimctlOutput(result.stdout.toString())
  } catch {
    return []
  }
}

/**
 * Parse adb devices output to extract connected devices.
 * Exported for testing.
 */
export function parseAdbOutput(stdout: string): Device[] {
  const devices: Device[] = []
  const lines = stdout.trim().split('\n').slice(1) // Skip header

  for (const line of lines) {
    if (!line.trim()) continue

    const parts = line.split(/\s+/)
    const id = parts[0]
    const status = parts[1]

    if (status !== 'device') continue

    // Extract device name from properties
    const modelMatch = line.match(/model:(\S+)/)
    const deviceMatch = line.match(/device:(\S+)/)
    const name = modelMatch?.[1] || deviceMatch?.[1] || id

    // Determine if emulator or device
    const type: DeviceType = id.startsWith('emulator-') ? 'simulator' : 'device'

    devices.push({
      id,
      name,
      platform: 'android',
      type,
      state: 'available',
    })
  }

  return devices
}

/**
 * List all connected Android devices/emulators.
 */
async function listAndroidDevices(): Promise<Device[]> {
  const result = await $`adb devices -l`.quiet().nothrow()
  if (result.exitCode !== 0) {
    return []
  }

  return parseAdbOutput(result.stdout.toString())
}

/**
 * List all devices for a platform.
 */
export async function listDevices(
  platform: Platform,
  type?: DeviceType,
): Promise<Device[]> {
  let devices: Device[]

  if (platform === 'ios') {
    if (type === 'simulator') {
      devices = await listIosSimulators()
    } else if (type === 'device') {
      devices = await listIosDevices()
    } else {
      const [simulators, physicalDevices] = await Promise.all([
        listIosSimulators(),
        listIosDevices(),
      ])
      devices = [...simulators, ...physicalDevices]
    }
  } else {
    devices = await listAndroidDevices()
    if (type) {
      devices = devices.filter((d) => d.type === type)
    }
  }

  return devices
}

/**
 * Select a device - auto-selects if only one, otherwise returns first available.
 * In the future, this could prompt the user to choose.
 */
export async function selectDevice(
  platform: Platform,
  type: DeviceType,
): Promise<Device | null> {
  const devices = await listDevices(platform, type)

  if (devices.length === 0) {
    return null
  }

  // Return first available device
  const available = devices.find((d) => d.state === 'available')
  return available || devices[0]
}

/**
 * Select an Android emulator from a list of devices.
 * Only considers devices with type 'simulator', ignores physical devices.
 */
export function selectAndroidEmulator(devices: Device[]): Device | undefined {
  return devices.find((d) => d.state === 'available' && d.type === 'simulator')
}

/**
 * Select an Android physical device from a list of devices.
 * Only considers devices with type 'device', ignores emulators.
 */
export function selectAndroidDevice(devices: Device[]): Device | undefined {
  return devices.find((d) => d.state === 'available' && d.type === 'device')
}

export interface InstallResult {
  success: boolean
  error?: 'locked' | 'not_found' | 'unknown'
  message?: string
}

/**
 * Install an app on an iOS device using devicectl.
 */
export async function installIosApp(
  device: Device,
  appPath: string,
): Promise<InstallResult> {
  const result = await runSimpleCommand([
    'xcrun',
    'devicectl',
    'device',
    'install',
    'app',
    '--device',
    device.id,
    appPath,
  ])

  if (result.success) {
    return { success: true }
  }

  const output = result.stdout + result.stderr

  // Check for common error patterns
  if (
    output.includes('device is locked') ||
    output.includes('passcode') ||
    output.includes('unlock')
  ) {
    return { success: false, error: 'locked', message: 'Device is locked' }
  }

  if (output.includes('not found') || output.includes('No device')) {
    return { success: false, error: 'not_found', message: 'Device not found' }
  }

  return { success: false, error: 'unknown', message: output }
}

/**
 * Launch an app on an iOS device using devicectl.
 */
export async function launchIosApp(
  device: Device,
  bundleId: string,
): Promise<InstallResult> {
  const result = await runSimpleCommand([
    'xcrun',
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    device.id,
    bundleId,
  ])

  if (result.success) {
    return { success: true }
  }

  const output = result.stdout + result.stderr

  if (
    output.includes('device is locked') ||
    output.includes('passcode') ||
    output.includes('unlock')
  ) {
    return { success: false, error: 'locked', message: 'Device is locked' }
  }

  return { success: false, error: 'unknown', message: output }
}

/**
 * Install an APK on an Android device using adb.
 */
export async function installAndroidApp(
  device: Device,
  apkPath: string,
): Promise<InstallResult> {
  const result = await $`adb -s ${device.id} install -r ${apkPath}`
    .quiet()
    .nothrow()

  if (result.exitCode === 0) {
    return { success: true }
  }

  const output = result.stdout.toString() + result.stderr.toString()
  return parseAdbInstallError(output)
}

/**
 * Parse adb install error output to determine the error type.
 * Exported for testing.
 */
export function parseAdbInstallError(output: string): InstallResult {
  // Device disconnected during install
  if (
    output.includes('device offline') ||
    output.includes('no devices') ||
    output.includes('not found')
  ) {
    return {
      success: false,
      error: 'not_found',
      message: 'Device disconnected',
    }
  }

  return {
    success: false,
    error: 'unknown',
    message: output || 'Install failed',
  }
}

/**
 * Launch an app on an Android device using adb.
 */
export async function launchAndroidApp(
  device: Device,
  packageName: string,
  activityName = '.MainActivity',
): Promise<InstallResult> {
  const result =
    await $`adb -s ${device.id} shell am start -n ${packageName}/${packageName}${activityName}`
      .quiet()
      .nothrow()

  if (result.exitCode === 0) {
    return { success: true }
  }

  return {
    success: false,
    error: 'unknown',
    message: result.stderr.toString(),
  }
}
