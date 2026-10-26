require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ImportSources'
  s.version        = package['version']
  s.summary        = 'Native import sources: durable refs, single-read copy and hash, media reads, open-in-place picking.'
  s.description    = 'Local Expo module exposing security-scoped bookmarks and grants, a copy that computes SHA256 in the same single read, PHAssetResourceManager media streaming with progress and cancellation, and an open-in-place document picker.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'sia-storage-app' => 'noreply@sia.tech' }
  s.homepage       = 'https://github.com/SiaFoundation/sia-storage-app'
  # Expo autolinking skips a pod whose minimum is above the Podfile's 16.4, and
  # raises a module's library target to 16.4 but not its test targets. Declaring
  # 16.4 here keeps the tests on it too, or `@testable import` fails to compile.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.{h,m,swift}'
  s.exclude_files = 'Package.swift'

  # Inert for a plain `pod install`; scripts/nativeTest.ts --simulator opts the
  # generated Podfile into this testspec and drives xcodebuild test.
  s.test_spec 'Tests' do |test|
    test.requires_app_host = true
    test.source_files = 'Tests/Simulator/**/*.swift'
    # ExpoModulesCore is ObjC++, so the test target has to link the C++ runtime
    # itself; without this the link fails on std::__1 and ___gxx_personality_v0.
    test.pod_target_xcconfig = {
      'CLANG_CXX_LIBRARY' => 'libc++',
      'OTHER_LDFLAGS' => '$(inherited) -lc++'
    }
  end
end
