const { version } = require('./package.json')
const { deriveAppVersion } = require('./appVersion')
const { resolveVariant } = require('./variants')

// App identity (name, bundle id, icons, app group) is driven by APP_VARIANT
// (dev | beta | prod); see variants.js. Defaults to `dev` for local builds.
const variant = resolveVariant()

// Release candidates (X.Y.Z-rc.N) ship with the plain X.Y.Z marketing version
// and are told apart by build number / versionCode; see appVersion.js.
const { marketingVersion, versionCode, buildNumber } = deriveAppVersion(version)

export default {
  expo: {
    name: variant.name,
    slug: variant.slug,
    scheme: 'sia',
    version: marketingVersion,
    orientation: 'default',
    icon: variant.iosIcon,
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: true,
      buildNumber,
      bundleIdentifier: variant.bundleId,
      entitlements: {
        'com.apple.security.application-groups': [variant.appGroup],
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Without this, UIDocumentPickerViewController(asCopy: false) still
        // delivers purgeable tmp copies instead of the originals, so the
        // bookmarks taken at pick time die as soon as iOS purges the copy.
        LSSupportsOpeningDocumentsInPlace: true,
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
        foregroundImage: variant.androidIcon,
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: variant.bundleId,
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
      'expo-image',
      ['./plugins/ios-target-16'],
      './plugins/android-gradle-cache',
      ['expo-video', { supportsPictureInPicture: true }],
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
    runtimeVersion: version,
    extra: {
      // The build encoding again, platform-neutral so the UI needn't branch on
      // ios.buildNumber vs android.versionCode.
      buildCode: versionCode,
      variant: variant.key,
      // `prod` stays true for any non-dev (release-signed) build — beta behaves
      // like production, just under a separate identity.
      prod: variant.isReleaseVariant,
      appGroup: variant.appGroup,
    },
  },
}
