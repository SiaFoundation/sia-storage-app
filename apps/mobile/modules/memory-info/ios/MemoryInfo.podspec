require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MemoryInfo'
  s.version        = package['version']
  s.summary        = 'Reports how much memory the system has left for this app.'
  s.description    = 'Local Expo module that reports the memory still available to the process, so buffer sizes can be chosen against what the app may actually spend rather than against the device total.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'sia-storage-app' => 'noreply@sia.tech' }
  s.homepage       = 'https://github.com/SiaFoundation/sia-storage-app'
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
end
