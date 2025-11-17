const PROD = process.env.PROD === 'true'

export default {
  expo: {
    name: PROD ? 'Sia Storage' : 'Sia Storage Dev',
    slug: PROD ? 'siastorage' : 'siastoragedev',
    scheme: 'sia',
    version: '1.0.0',
    orientation: 'portrait',
    icon: PROD ? './assets/app-icon-ios.png' : './assets/app-icon-ios-dev.png',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: PROD ? 'sia.storage' : 'sia.storage.dev',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          'Allow $(PRODUCT_NAME) to access your photo library to select and upload photos.',
        NSPhotoLibraryAddUsageDescription:
          'Allow $(PRODUCT_NAME) to save images to your photo library.',
        NSCameraUsageDescription:
          'Allow $(PRODUCT_NAME) to use the camera to take photos.',
        UIBackgroundModes: ['fetch', 'processing'],
        BGTaskSchedulerPermittedIdentifiers: ['com.transistorsoft.fetch'],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: PROD
          ? './assets/app-icon-android.png'
          : './assets/app-icon-android-dev.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: PROD ? 'sia.storage' : 'sia.storage.dev',
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
      prod: PROD,
    },
  },
}
