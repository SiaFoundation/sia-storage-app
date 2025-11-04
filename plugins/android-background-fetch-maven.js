// Expo config plugin to ensure Gradle resolves tsbackgroundfetch from the local AAR bundled by react-native-background-fetch.
const { withProjectBuildGradle } = require('@expo/config-plugins')

/**
 * Injects into android/build.gradle -> allprojects.repositories:
 *   maven {
 *     // react-native-background-fetch
 *     url("${project(':react-native-background-fetch').projectDir}/libs")
 *   }
 */
function withBackgroundFetchMaven(config) {
  return withProjectBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents

    // Skip if already present.
    if (
      buildGradle.includes(
        "project(':react-native-background-fetch').projectDir}/libs"
      )
    ) {
      return config
    }

    const anchor = "maven { url 'https://www.jitpack.io' }"
    const insertion = [
      anchor,
      '    maven {',
      '      // react-native-background-fetch',
      '      url("${project(\':react-native-background-fetch\').projectDir}/libs")',
      '    }',
    ].join('\n')

    if (buildGradle.includes(anchor)) {
      config.modResults.contents = buildGradle.replace(anchor, insertion)
      return config
    }

    // Fallback: append inside the repositories block if anchor not found.
    const reposStart = buildGradle.indexOf('repositories {')
    if (reposStart !== -1) {
      const before = buildGradle.slice(0, reposStart + 'repositories {'.length)
      const after = buildGradle.slice(reposStart + 'repositories {'.length)
      const toInject = [
        '\n',
        '    maven {',
        '      // react-native-background-fetch',
        '      url("${project(\':react-native-background-fetch\').projectDir}/libs")',
        '    }',
      ].join('\n')
      config.modResults.contents = before + toInject + after
      return config
    }

    // As a last resort, append a well-formed allprojects.repositories block.
    config.modResults.contents =
      buildGradle +
      [
        '\n',
        'allprojects {',
        '  repositories {',
        '    maven {',
        '      // react-native-background-fetch',
        '      url("${project(\':react-native-background-fetch\').projectDir}/libs")',
        '    }',
        '  }',
        '}',
        '\n',
      ].join('\n')

    return config
  })
}

module.exports = withBackgroundFetchMaven
