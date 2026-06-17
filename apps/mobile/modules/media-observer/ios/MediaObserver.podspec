require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MediaObserver'
  s.version        = package['version']
  s.summary        = 'Durable, insertion-keyed change cursor over the photo library.'
  s.description    = 'Local Expo module exposing PhotoKit change history (fetchPersistentChanges) as a durable cursor of inserted asset ids, so the new-photos feature detects additions by what was actually added rather than by timestamp heuristics.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'sia-storage-app' => 'noreply@sia.tech' }
  s.homepage       = 'https://github.com/SiaFoundation/sia-storage-app'
  # Must match the Podfile's declared target (15.1) or Expo autolinking skips the
  # pod via supports_platform?; the ios-target-16 plugin forces the actual build
  # to 16.0 in post_install, where the iOS 16 PhotoKit change-history APIs resolve.
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
