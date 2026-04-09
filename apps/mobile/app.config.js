const { version } = require('./package.json')
const RELEASE = process.env.RELEASE === 'true'
const APP_GROUP = RELEASE ? 'group.sia.storage' : 'group.sia.storage.dev'

// Calculate Android versionCode from semver (1.2.3 → 10203)
// This ensures versionCode always increases with version bumps
const [major, minor, patch] = version.split('.').map(Number)
const versionCode = major * 10000 + minor * 100 + patch

export default {
  expo: {
    name: RELEASE ? 'Sia Storage' : 'Sia Storage Dev',
    slug: RELEASE ? 'siastorage' : 'siastoragedev',
    scheme: 'sia',
    version,
    orientation: 'default',
    icon: RELEASE
      ? './assets/app-icon-ios.png'
      : './assets/app-icon-ios-dev.png',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: RELEASE ? 'sia.storage' : 'sia.storage.dev',
      entitlements: {
        'com.apple.security.application-groups': [APP_GROUP],
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          'Photos and videos from your library are uploaded to your Sia decentralized cloud storage. For example, you can select photos to back up manually, or enable automatic sync to continuously back up new photos as you take them.',
        NSCameraUsageDescription:
          'Capture photos and videos to upload directly to your Sia cloud storage. For example, take a photo of a document to immediately back it up for safekeeping.',
        NSMicrophoneUsageDescription:
          'The microphone captures audio when you record videos with the camera. For example, when you record a video to upload to Sia, the audio is preserved alongside the video.',
        UIBackgroundModes: ['fetch', 'processing'],
        BGTaskSchedulerPermittedIdentifiers: [
          'com.transistorsoft.fetch',
          'com.transistorsoft.processing',
        ],
      },
    },
    android: {
      versionCode,
      adaptiveIcon: {
        foregroundImage: RELEASE
          ? './assets/app-icon-android.png'
          : './assets/app-icon-android-dev.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: RELEASE ? 'sia.storage' : 'sia.storage.dev',
      permissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.ACCESS_MEDIA_LOCATION',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-secure-store',
      'expo-sqlite',
      ['./plugins/ios-target-16'],
      'expo-video',
      './plugins/background-fetch',
      [
        'react-native-maps',
        {
          ...(process.env.GOOGLE_MAPS_API_KEY && {
            androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
          }),
        },
      ],
      [
        'expo-share-intent',
        {
          iosActivationRules: {
            NSExtensionActivationSupportsText: true,
            NSExtensionActivationSupportsImageWithMaxCount: 1000,
            NSExtensionActivationSupportsMovieWithMaxCount: 1000,
            NSExtensionActivationSupportsFileWithMaxCount: 1000,
          },
          androidIntentFilters: [
            'text/*',
            'image/*',
            'video/*',
            'audio/*',
            'application/json',
            'application/pdf',
            'application/octet-stream',
          ],
          androidMultiIntentFilters: [
            'text/*',
            'image/*',
            'video/*',
            'audio/*',
            'application/json',
            'application/pdf',
            'application/octet-stream',
          ],
        },
      ],
      './plugins/android-share-file-provider',
      [
        './plugins/android-release-signing',
        {
          storeFile: 'android-release.keystore',
          keyAlias: 'siaReleaseKey',
        },
      ],
    ],
    runtimeVersion: {
      policy: 'appVersion',
    },
    extra: {
      prod: RELEASE,
      appGroup: APP_GROUP,
    },
  },
}
