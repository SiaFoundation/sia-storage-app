const { version } = require('./package.json')
const RELEASE = process.env.RELEASE === 'true'

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
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          'Allow $(PRODUCT_NAME) to access your photo library to select and upload photos.',
        NSPhotoLibraryAddUsageDescription:
          'Allow $(PRODUCT_NAME) to save images to your photo library.',
        NSCameraUsageDescription:
          'Allow $(PRODUCT_NAME) to use the camera to take photos and videos.',
        NSMicrophoneUsageDescription:
          'Allow $(PRODUCT_NAME) to use the microphone to record audio with videos.',
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
      ['./plugins/android-background-fetch-maven'],
      'react-native-background-fetch',
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
    },
  },
}
