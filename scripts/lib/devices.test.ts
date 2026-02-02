import {
  type Device,
  parseAdbInstallError,
  parseAdbOutput,
  parseDevicectlOutput,
  parseSimctlOutput,
  selectAndroidDevice,
  selectAndroidEmulator,
} from './devices'

/**
 * Output from: xcrun devicectl list devices --json-output /dev/stdout
 *
 * Note: devicectl outputs BOTH human-readable text AND JSON to stdout.
 * The JSON starts after the table. Identifiers/serials are sanitized.
 */
const DEVICECTL_LIST_DEVICES_OUTPUT = `Devices:
Name   Hostname                                     Identifier                             State                Model
----   ------------------------------------------   ------------------------------------   ------------------   ----------------------
MyPhone   00001234-000000001234CDEF.coredevice.local   AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB   available (paired)   iPhone 16 (iPhone17,3)
{
  "info" : {
    "arguments" : [
      "devicectl",
      "list",
      "devices",
      "--json-output",
      "/dev/stdout"
    ],
    "commandType" : "devicectl.list.devices",
    "environment" : {
      "TERM" : "xterm-256color"
    },
    "jsonVersion" : 2,
    "outcome" : "success",
    "version" : "397.28"
  },
  "result" : {
    "devices" : [
      {
        "capabilities" : [
          {
            "featureIdentifier" : "com.apple.coredevice.feature.acquireusageassertion",
            "name" : "Acquire Usage Assertion"
          },
          {
            "featureIdentifier" : "com.apple.coredevice.feature.unpairdevice",
            "name" : "Unpair Device"
          },
          {
            "featureIdentifier" : "com.apple.coredevice.feature.connectdevice",
            "name" : "Connect to Device"
          }
        ],
        "connectionProperties" : {
          "authenticationType" : "manualPairing",
          "isMobileDeviceOnly" : false,
          "lastConnectionDate" : "2026-01-27T23:24:05.892Z",
          "pairingState" : "paired",
          "potentialHostnames" : [
            "00001234-000000001234CDEF.coredevice.local",
            "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB.coredevice.local"
          ],
          "transportType" : "localNetwork",
          "tunnelState" : "disconnected",
          "tunnelTransportProtocol" : "tcp"
        },
        "deviceProperties" : {
          "bootedFromSnapshot" : true,
          "bootedSnapshotName" : "com.apple.os.update-AAAAAAAAAA",
          "ddiServicesAvailable" : false,
          "developerModeStatus" : "enabled",
          "hasInternalOSBuild" : false,
          "name" : "MyPhone",
          "osBuildUpdate" : "22C55",
          "osVersionNumber" : "18.2",
          "rootFileSystemIsWritable" : false
        },
        "hardwareProperties" : {
          "cpuType" : {
            "name" : "arm64e",
            "subType" : 2,
            "type" : 16777228
          },
          "deviceType" : "iPhone",
          "ecid" : 1234567890123456,
          "hardwareModel" : "D47AP",
          "internalStorageCapacity" : 256000000000,
          "isProductionFused" : true,
          "marketingName" : "iPhone 16",
          "platform" : "iOS",
          "productType" : "iPhone17,3",
          "reality" : "physical",
          "serialNumber" : "XXXX1234XX",
          "supportedCPUTypes" : [
            {
              "name" : "arm64e",
              "subType" : 2,
              "type" : 16777228
            }
          ],
          "supportedDeviceFamilies" : [
            1
          ],
          "thinningProductType" : "iPhone17,3",
          "udid" : "00001234-000000001234CDEF"
        },
        "identifier" : "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB",
        "tags" : [

        ],
        "visibilityClass" : "default"
      }
    ]
  }
}`

/**
 * Output from: xcrun devicectl list devices --json-output /dev/stdout
 * When device is connected but tunnel is active (USB connected)
 */
const DEVICECTL_LIST_DEVICES_CONNECTED_OUTPUT = `Devices:
Name   Hostname                                     Identifier                             State                Model
----   ------------------------------------------   ------------------------------------   ------------------   ----------------------
MyPhone   00001234-000000001234CDEF.coredevice.local   AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB   available (paired)   iPhone 16 (iPhone17,3)
{
  "info" : {
    "arguments" : ["devicectl", "list", "devices", "--json-output", "/dev/stdout"],
    "commandType" : "devicectl.list.devices",
    "jsonVersion" : 2,
    "outcome" : "success",
    "version" : "397.28"
  },
  "result" : {
    "devices" : [
      {
        "capabilities" : [],
        "connectionProperties" : {
          "authenticationType" : "manualPairing",
          "pairingState" : "paired",
          "transportType" : "wired",
          "tunnelState" : "connected",
          "tunnelTransportProtocol" : "tcp"
        },
        "deviceProperties" : {
          "developerModeStatus" : "enabled",
          "name" : "MyPhone",
          "osVersionNumber" : "18.2"
        },
        "hardwareProperties" : {
          "deviceType" : "iPhone",
          "marketingName" : "iPhone 16",
          "platform" : "iOS",
          "udid" : "00001234-000000001234CDEF"
        },
        "identifier" : "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB",
        "visibilityClass" : "default"
      }
    ]
  }
}`

/**
 * Output from: xcrun devicectl list devices --json-output /dev/stdout
 * When no devices are connected
 */
const DEVICECTL_LIST_DEVICES_EMPTY_OUTPUT = `Devices:
Name   Hostname   Identifier   State   Model
----   --------   ----------   -----   -----
{
  "info" : {
    "arguments" : ["devicectl", "list", "devices", "--json-output", "/dev/stdout"],
    "commandType" : "devicectl.list.devices",
    "jsonVersion" : 2,
    "outcome" : "success",
    "version" : "397.28"
  },
  "result" : {
    "devices" : []
  }
}`

/**
 * Output from: xcrun simctl list devices booted --json
 * When a simulator is booted
 */
const SIMCTL_LIST_DEVICES_BOOTED_OUTPUT = `{
  "devices" : {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-3" : [
      {
        "lastBootedAt" : "2026-01-27T20:28:25Z",
        "dataPath" : "/Users/user/Library/Developer/CoreSimulator/Devices/CCCCCCCC-4444-5555-6666-DDDDDDDDDDDD/data",
        "dataPathSize" : 2734256128,
        "logPath" : "/Users/user/Library/Logs/CoreSimulator/CCCCCCCC-4444-5555-6666-DDDDDDDDDDDD",
        "udid" : "CCCCCCCC-4444-5555-6666-DDDDDDDDDDDD",
        "isAvailable" : true,
        "logPathSize" : 581632,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
        "state" : "Booted",
        "name" : "iPhone 16 Pro"
      }
    ]
  }
}`

/**
 * Output from: xcrun simctl list devices booted --json
 * When multiple simulators are booted across different runtimes
 */
const SIMCTL_LIST_DEVICES_MULTIPLE_BOOTED_OUTPUT = `{
  "devices" : {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-3" : [
      {
        "udid" : "CCCCCCCC-4444-5555-6666-DDDDDDDDDDDD",
        "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
        "state" : "Booted",
        "name" : "iPhone 16 Pro"
      },
      {
        "udid" : "EEEEEEEE-7777-8888-9999-FFFFFFFFFFFF",
        "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation",
        "state" : "Booted",
        "name" : "iPhone SE (3rd generation)"
      }
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5" : [
      {
        "udid" : "11111111-AAAA-BBBB-CCCC-222222222222",
        "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M4-8GB",
        "state" : "Booted",
        "name" : "iPad Pro 11-inch (M4)"
      }
    ]
  }
}`

/**
 * Output from: xcrun simctl list devices booted --json
 * When no simulators are booted
 */
const SIMCTL_LIST_DEVICES_NONE_BOOTED_OUTPUT = `{
  "devices" : {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-3" : [

    ]
  }
}`

/**
 * Output from: adb devices -l
 * When an emulator is connected
 */
const ADB_DEVICES_EMULATOR_OUTPUT = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1`

/**
 * Output from: adb devices -l
 * When a physical Android device is connected
 */
const ADB_DEVICES_PHYSICAL_OUTPUT = `List of devices attached
RFXXXXXXXX             device usb:1234567X product:starqltesq model:SM_G965U device:starqltesq transport_id:2`

/**
 * Output from: adb devices -l
 * When multiple devices are connected
 */
const ADB_DEVICES_MULTIPLE_OUTPUT = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
RFXXXXXXXX             device usb:1234567X product:starqltesq model:SM_G965U device:starqltesq transport_id:2
emulator-5556          device product:sdk_gphone64_arm64 model:Pixel_7_Pro device:emu64a transport_id:3`

/**
 * Output from: adb devices -l
 * When no devices are connected
 */
const ADB_DEVICES_NONE_OUTPUT = `List of devices attached`

/**
 * Output from: adb devices -l
 * When a device is unauthorized (needs to accept USB debugging prompt)
 */
const ADB_DEVICES_UNAUTHORIZED_OUTPUT = `List of devices attached
RFXXXXXXXX             unauthorized usb:1234567X transport_id:1`

describe('parseDevicectlOutput', () => {
  test('parses device with paired state (network connection)', () => {
    const devices = parseDevicectlOutput(DEVICECTL_LIST_DEVICES_OUTPUT)

    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({
      id: 'AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB',
      name: 'MyPhone',
      platform: 'ios',
      type: 'device',
      state: 'available',
    })
  })

  test('parses device with connected tunnel state (USB connection)', () => {
    const devices = parseDevicectlOutput(
      DEVICECTL_LIST_DEVICES_CONNECTED_OUTPUT,
    )

    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({
      id: 'AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB',
      name: 'MyPhone',
      platform: 'ios',
      type: 'device',
      state: 'available',
    })
  })

  test('returns empty array when no devices', () => {
    const devices = parseDevicectlOutput(DEVICECTL_LIST_DEVICES_EMPTY_OUTPUT)
    expect(devices).toHaveLength(0)
  })

  test('returns empty array when no JSON found', () => {
    const devices = parseDevicectlOutput('Some random output without JSON')
    expect(devices).toHaveLength(0)
  })

  test('handles output with human-readable table before JSON', () => {
    // The key feature: devicectl outputs a table THEN JSON
    // We need to skip the table and find the JSON
    const devices = parseDevicectlOutput(DEVICECTL_LIST_DEVICES_OUTPUT)
    expect(devices).toHaveLength(1)
    expect(devices[0].name).toBe('MyPhone')
  })
})

describe('parseSimctlOutput', () => {
  test('parses single booted simulator', () => {
    const devices = parseSimctlOutput(SIMCTL_LIST_DEVICES_BOOTED_OUTPUT)

    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({
      id: 'CCCCCCCC-4444-5555-6666-DDDDDDDDDDDD',
      name: 'iPhone 16 Pro',
      platform: 'ios',
      type: 'simulator',
      state: 'available',
    })
  })

  test('parses multiple booted simulators across runtimes', () => {
    const devices = parseSimctlOutput(
      SIMCTL_LIST_DEVICES_MULTIPLE_BOOTED_OUTPUT,
    )

    expect(devices).toHaveLength(3)
    expect(devices.map((d) => d.name)).toEqual([
      'iPhone 16 Pro',
      'iPhone SE (3rd generation)',
      'iPad Pro 11-inch (M4)',
    ])
    expect(devices.every((d) => d.type === 'simulator')).toBe(true)
    expect(devices.every((d) => d.state === 'available')).toBe(true)
  })

  test('returns empty array when no simulators booted', () => {
    const devices = parseSimctlOutput(SIMCTL_LIST_DEVICES_NONE_BOOTED_OUTPUT)
    expect(devices).toHaveLength(0)
  })
})

describe('parseAdbOutput', () => {
  test('parses emulator device', () => {
    const devices = parseAdbOutput(ADB_DEVICES_EMULATOR_OUTPUT)

    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({
      id: 'emulator-5554',
      name: 'sdk_gphone64_arm64', // model takes precedence
      platform: 'android',
      type: 'simulator', // emulator-* prefix = simulator
      state: 'available',
    })
  })

  test('parses physical Android device', () => {
    const devices = parseAdbOutput(ADB_DEVICES_PHYSICAL_OUTPUT)

    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({
      id: 'RFXXXXXXXX',
      name: 'SM_G965U',
      platform: 'android',
      type: 'device', // Not emulator-* prefix = physical device
      state: 'available',
    })
  })

  test('parses multiple devices', () => {
    const devices = parseAdbOutput(ADB_DEVICES_MULTIPLE_OUTPUT)

    expect(devices).toHaveLength(3)

    // First emulator
    expect(devices[0].id).toBe('emulator-5554')
    expect(devices[0].type).toBe('simulator')

    // Physical device
    expect(devices[1].id).toBe('RFXXXXXXXX')
    expect(devices[1].type).toBe('device')

    // Second emulator with different model name
    expect(devices[2].id).toBe('emulator-5556')
    expect(devices[2].name).toBe('Pixel_7_Pro')
    expect(devices[2].type).toBe('simulator')
  })

  test('returns empty array when no devices', () => {
    const devices = parseAdbOutput(ADB_DEVICES_NONE_OUTPUT)
    expect(devices).toHaveLength(0)
  })

  test('ignores unauthorized devices', () => {
    const devices = parseAdbOutput(ADB_DEVICES_UNAUTHORIZED_OUTPUT)
    expect(devices).toHaveLength(0)
  })

  test('prefers model over device name', () => {
    const devices = parseAdbOutput(ADB_DEVICES_PHYSICAL_OUTPUT)
    // model:SM_G965U should be used, not device:starqltesq
    expect(devices[0].name).toBe('SM_G965U')
  })
})

describe('selectAndroidEmulator', () => {
  test('selects emulator when only emulators available', () => {
    const devices = parseAdbOutput(ADB_DEVICES_EMULATOR_OUTPUT)
    const selected = selectAndroidEmulator(devices)

    expect(selected).toBeDefined()
    expect(selected?.type).toBe('simulator')
    expect(selected?.id).toBe('emulator-5554')
  })

  test('ignores physical devices, returns undefined when only physical devices', () => {
    const devices = parseAdbOutput(ADB_DEVICES_PHYSICAL_OUTPUT)
    const selected = selectAndroidEmulator(devices)

    expect(selected).toBeUndefined()
  })

  test('selects only emulator when both emulators and physical devices present', () => {
    const devices = parseAdbOutput(ADB_DEVICES_MULTIPLE_OUTPUT)
    const selected = selectAndroidEmulator(devices)

    expect(selected).toBeDefined()
    expect(selected?.type).toBe('simulator')
    expect(selected?.id).toBe('emulator-5554')
  })

  test('returns undefined when no devices', () => {
    const devices = parseAdbOutput(ADB_DEVICES_NONE_OUTPUT)
    const selected = selectAndroidEmulator(devices)

    expect(selected).toBeUndefined()
  })

  test('ignores unavailable emulators', () => {
    const devices: Device[] = [
      {
        id: 'emulator-5554',
        name: 'Pixel_7',
        platform: 'android',
        type: 'simulator',
        state: 'unavailable',
      },
    ]
    const selected = selectAndroidEmulator(devices)

    expect(selected).toBeUndefined()
  })
})

describe('selectAndroidDevice', () => {
  test('selects physical device when only physical devices available', () => {
    const devices = parseAdbOutput(ADB_DEVICES_PHYSICAL_OUTPUT)
    const selected = selectAndroidDevice(devices)

    expect(selected).toBeDefined()
    expect(selected?.type).toBe('device')
    expect(selected?.id).toBe('RFXXXXXXXX')
  })

  test('ignores emulators, returns undefined when only emulators', () => {
    const devices = parseAdbOutput(ADB_DEVICES_EMULATOR_OUTPUT)
    const selected = selectAndroidDevice(devices)

    expect(selected).toBeUndefined()
  })

  test('selects only physical device when both emulators and physical devices present', () => {
    const devices = parseAdbOutput(ADB_DEVICES_MULTIPLE_OUTPUT)
    const selected = selectAndroidDevice(devices)

    expect(selected).toBeDefined()
    expect(selected?.type).toBe('device')
    expect(selected?.id).toBe('RFXXXXXXXX')
  })

  test('returns undefined when no devices', () => {
    const devices = parseAdbOutput(ADB_DEVICES_NONE_OUTPUT)
    const selected = selectAndroidDevice(devices)

    expect(selected).toBeUndefined()
  })

  test('ignores unavailable physical devices', () => {
    const devices: Device[] = [
      {
        id: 'RFXXXXXXXX',
        name: 'SM_G965U',
        platform: 'android',
        type: 'device',
        state: 'unavailable',
      },
    ]
    const selected = selectAndroidDevice(devices)

    expect(selected).toBeUndefined()
  })
})

describe('parseAdbInstallError', () => {
  test('detects device offline error', () => {
    const result = parseAdbInstallError(
      'error: device offline\nadb: failed to install app.apk',
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('not_found')
    expect(result.message).toBe('Device disconnected')
  })

  test('detects no devices error', () => {
    const result = parseAdbInstallError(
      'error: no devices/emulators found\nadb: failed to install app.apk',
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('not_found')
    expect(result.message).toBe('Device disconnected')
  })

  test('detects device not found error', () => {
    const result = parseAdbInstallError(
      "error: device 'RFXXXXXXXX' not found\nadb: failed to install app.apk",
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('not_found')
    expect(result.message).toBe('Device disconnected')
  })

  test('returns unknown error for other failures', () => {
    const result = parseAdbInstallError(
      'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]',
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('unknown')
    expect(result.message).toBe('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]')
  })

  test('returns default message for empty output', () => {
    const result = parseAdbInstallError('')

    expect(result.success).toBe(false)
    expect(result.error).toBe('unknown')
    expect(result.message).toBe('Install failed')
  })
})
