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
  # Expo autolinking skips a pod whose minimum is above the Podfile's 16.4, and
  # raises a module's library target to 16.4 but not its test targets. Declaring
  # 16.4 here keeps the tests on it too, and the iOS 16 PhotoKit change-history
  # APIs need at least 16.
  s.platforms      = { :ios => '16.4' }
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
