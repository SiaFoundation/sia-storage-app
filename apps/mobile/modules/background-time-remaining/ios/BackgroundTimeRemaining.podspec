require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'BackgroundTimeRemaining'
  s.version        = package['version']
  s.summary        = 'Exposes UIApplication.backgroundTimeRemaining to JS.'
  s.description    = 'Local Expo module that surfaces iOS UIApplication.backgroundTimeRemaining so the suspension drain loop can cap itself on the actual remaining background-execution budget.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'sia-storage-app' => 'noreply@sia.tech' }
  s.homepage       = 'https://github.com/SiaFoundation/sia-storage-app'
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
