// Ensures all CocoaPods targets use iOS 16.0 by injecting into Podfile's post_install.
// Works across prebuilds and app renames so you don't have to hand-edit Podfile.

const { withPodfile } = require('@expo/config-plugins')

module.exports = function withIosTarget16(config) {
  return withPodfile(config, (cfg) => {
    try {
      let contents = cfg.modResults.contents
      const marker = 'Auto-injected: Force all targets to iOS 16.0'
      if (contents.includes(marker)) {
        cfg.modResults.contents = contents
        return cfg
      }

      // Insert near the end of post_install while preserving indentation,
      // and ensure the inner 'end' keeps its original indent level.
      const postInstallBlock =
        /(\n?)(^[ \t]*)post_install do \|installer\|([\s\S]*?)^[ \t]*end\n/m
      const m = contents.match(postInstallBlock)
      if (m) {
        const leadingNewline = m[1] || ''
        const indent = m[2] || '' // indentation before post_install
        const body = m[3] || '' // content inside post_install
        const ind2 = indent + '  '
        const inj = `\n${ind2}# ${marker}\n${ind2}installer.pods_project.targets.each do |t|\n${ind2}  t.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0' }\n${ind2}end\n${ind2}installer.aggregate_targets.each do |agg|\n${ind2}  agg.user_project.native_targets.each do |nt|\n${ind2}    nt.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0' }\n${ind2}  end\n${ind2}end\n`
        contents = contents.replace(
          postInstallBlock,
          `${leadingNewline}${indent}post_install do |installer|${body}${inj}${indent}end\n`
        )
      }

      cfg.modResults.contents = contents
    } catch (e) {
      // If anything goes wrong, leave file untouched; users can still build.
    }
    return cfg
  })
}
