// Build-variant identity — the single source of truth for app naming, bundle
// identifiers, icons, app groups, iOS provisioning-profile names, and the
// generated Xcode project name. Consumed by app.config.js (Expo), the release
// scripts, and (indirectly) Fastlane.
//
// Selected via the APP_VARIANT env var (dev | beta | prod); defaults to `dev`.
//
//   dev  — local development build. Built by scripts/dev.ts.
//   beta — CI-distributed parallel beta app. Ships to TestFlight + Play internal
//          on every release and is NEVER promoted to a public store listing.
//   prod — the public app. Same code/version as beta; promoted to the App Store /
//          Play production manually once the matching beta build looks good.
//
// Each variant has a distinct bundle id / package, so all three can be installed
// side by side on one device.

const VARIANTS = {
  // xcodeName must equal the project `expo prebuild` generates from `name`
  // (the display name with spaces stripped); it names the .xcworkspace,
  // .xcodeproj, scheme, main target, and IPA. The Fastfile reads it via
  // IOS_PROJECT_NAME (exported by releaseIos.ts).
  dev: {
    name: 'Sia Storage Dev',
    xcodeName: 'SiaStorageDev',
    slug: 'siastoragedev',
    bundleId: 'sia.storage.dev',
    iosIcon: './assets/app-icon-ios-dev.png',
    androidIcon: './assets/app-icon-android-dev.png',
  },
  beta: {
    name: 'Sia Storage Beta',
    xcodeName: 'SiaStorageBeta',
    slug: 'siastoragebeta',
    bundleId: 'sia.storage.beta',
    iosIcon: './assets/app-icon-ios-beta.png',
    androidIcon: './assets/app-icon-android-beta.png',
  },
  prod: {
    name: 'Sia Storage',
    xcodeName: 'SiaStorage',
    slug: 'siastorage',
    bundleId: 'sia.storage',
    iosIcon: './assets/app-icon-ios.png',
    androidIcon: './assets/app-icon-android.png',
  },
}

const DEFAULT_VARIANT = 'dev'

// Resolve a variant name into the full, derived identity. Unknown/empty names
// fall back to `dev`.
function resolveVariant(name = process.env.APP_VARIANT) {
  const key = name && Object.hasOwn(VARIANTS, name) ? name : DEFAULT_VARIANT
  const variant = VARIANTS[key]
  return {
    key,
    ...variant,
    shareExtBundleId: `${variant.bundleId}.share-extension`,
    appGroup: `group.${variant.bundleId}`,
    // Distribution provisioning-profile names as registered in the Apple
    // Developer portal — derived from the display name so they stay in lockstep.
    iosProfileName: `${variant.name} Distribution`,
    shareExtProfileName: `${variant.name} Share Extension Distribution`,
    // dev builds are debug-signed; beta and prod are release-signed.
    isReleaseVariant: key !== 'dev',
  }
}

module.exports = { VARIANTS, DEFAULT_VARIANT, resolveVariant }
