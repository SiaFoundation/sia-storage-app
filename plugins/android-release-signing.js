const {
  withAppBuildGradle,
  withGradleProperties,
} = require('@expo/config-plugins')

const DEFAULTS = {
  storeFile: 'android-release.keystore',
  keyAlias: 'siaReleaseKey',
  storeFileProperty: 'SIA_RELEASE_STORE_FILE',
  keyAliasProperty: 'SIA_RELEASE_KEY_ALIAS',
  storePasswordProperty: 'SIA_RELEASE_STORE_PASSWORD',
  keyPasswordProperty: 'SIA_RELEASE_KEY_PASSWORD',
  storeFileEnv: 'SIA_RELEASE_STORE_FILE',
  keyAliasEnv: 'SIA_RELEASE_KEY_ALIAS',
  storePasswordEnv: 'SIA_RELEASE_STORE_PASSWORD',
  keyPasswordEnv: 'SIA_RELEASE_KEY_PASSWORD',
}

const SIGNING_TAG = '// Added by android-release-signing plugin.'

function isReleaseBuild() {
  if (process.env.RELEASE) {
    return process.env.RELEASE === 'true'
  }

  const easProfile = process.env.EAS_BUILD_PROFILE
  if (easProfile) {
    return ['production', 'release'].includes(easProfile.toLowerCase())
  }

  const gradleTask = process.env.ANDROID_GRADLE_TASK
  if (gradleTask) {
    return gradleTask.toLowerCase().includes('release')
  }

  return false
}

function ensureProperty(modResults, key, value) {
  if (value === undefined || value === null) {
    return
  }

  const existing = modResults.find(
    (item) => item.type === 'property' && item.key === key,
  )

  if (existing) {
    existing.value = value
    return
  }

  modResults.push({
    type: 'property',
    key,
    value,
  })
}

function injectReleaseSigningBlock(contents, options) {
  if (contents.includes(SIGNING_TAG)) {
    return contents
  }

  const signingIndex = contents.indexOf('signingConfigs {')
  if (signingIndex === -1) {
    return contents
  }

  const blockStart = contents.indexOf('{', signingIndex)
  if (blockStart === -1) {
    return contents
  }

  let depth = 1
  let cursor = blockStart + 1
  while (depth > 0 && cursor < contents.length) {
    const char = contents[cursor]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    }
    cursor += 1
  }

  if (depth !== 0) {
    return contents
  }

  const blockEnd = cursor - 1
  const before = contents.slice(0, blockEnd)
  const after = contents.slice(blockEnd)

  const releaseBlock = `
        release { ${SIGNING_TAG}
            def releaseStoreFile = System.getenv("${options.storeFileEnv}") ?: project.findProperty("${options.storeFileProperty}")
            def releaseStorePassword = System.getenv("${options.storePasswordEnv}") ?: project.findProperty("${options.storePasswordProperty}")
            def releaseKeyAlias = System.getenv("${options.keyAliasEnv}") ?: project.findProperty("${options.keyAliasProperty}")
            def releaseKeyPassword = System.getenv("${options.keyPasswordEnv}") ?: project.findProperty("${options.keyPasswordProperty}")

            if (!releaseStoreFile || !releaseStorePassword || !releaseKeyAlias || !releaseKeyPassword) {
                throw new GradleException("Missing release signing values. Provide SIA_* environment variables or gradle.properties entries.")
            }

            storeFile file(releaseStoreFile)
            storePassword releaseStorePassword
            keyAlias releaseKeyAlias
            keyPassword releaseKeyPassword
        }
`

  return before + releaseBlock + after
}

// Ensures a specific buildType block references the desired signingConfig, inserting or updating the line without disturbing surrounding Gradle content.
function ensureBlockSigningConfig(contents, blockName, targetConfig) {
  const buildTypesAnchor = 'buildTypes {'
  const buildTypesStart = contents.indexOf(buildTypesAnchor)
  if (buildTypesStart === -1) {
    return contents
  }

  const buildTypesBraceStart = contents.indexOf('{', buildTypesStart)
  if (buildTypesBraceStart === -1) {
    return contents
  }

  let depth = 1
  let cursor = buildTypesBraceStart + 1
  while (depth > 0 && cursor < contents.length) {
    const char = contents[cursor]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    }
    cursor += 1
  }

  if (depth !== 0) {
    return contents
  }

  const buildTypesEnd = cursor - 1
  const blockAnchor = `${blockName} {`
  const blockStart = contents.indexOf(blockAnchor, buildTypesBraceStart + 1)
  if (blockStart === -1 || blockStart > buildTypesEnd) {
    return contents
  }

  const blockBraceStart = contents.indexOf('{', blockStart)
  if (blockBraceStart === -1 || blockBraceStart > buildTypesEnd) {
    return contents
  }

  depth = 1
  cursor = blockBraceStart + 1
  while (depth > 0 && cursor < contents.length) {
    const char = contents[cursor]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    }
    cursor += 1
  }

  if (depth !== 0) {
    return contents
  }

  const blockEnd = cursor - 1
  const before = contents.slice(0, blockBraceStart + 1)
  const inside = contents.slice(blockBraceStart + 1, blockEnd)
  const after = contents.slice(blockEnd)

  const signingRegex = /signingConfig\s+signingConfigs\.\w+/
  let nextInside
  if (signingRegex.test(inside)) {
    nextInside = inside.replace(
      signingRegex,
      `signingConfig signingConfigs.${targetConfig}`,
    )
  } else {
    const lineStart = contents.lastIndexOf('\n', blockStart) + 1
    const indentMatch = contents.slice(lineStart, blockStart).match(/^\s*/)
    const baseIndent = indentMatch ? indentMatch[0] : ''
    const innerIndent = `${baseIndent}    `
    nextInside =
      inside +
      `\n${innerIndent}signingConfig signingConfigs.${targetConfig}\n${baseIndent}`
  }

  return before + nextInside + after
}

function ensureReleaseSigningUsage(contents) {
  let nextContents = ensureBlockSigningConfig(contents, 'release', 'release')
  nextContents = ensureBlockSigningConfig(nextContents, 'debug', 'debug')
  return nextContents
}

function stripSigningConfigAssignments(contents) {
  const anchor = 'signingConfigs {'
  const blockStart = contents.indexOf(anchor)
  if (blockStart === -1) {
    return contents
  }

  const braceStart = contents.indexOf('{', blockStart)
  if (braceStart === -1) {
    return contents
  }

  let depth = 1
  let cursor = braceStart + 1
  while (depth > 0 && cursor < contents.length) {
    const char = contents[cursor]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    }
    cursor += 1
  }

  if (depth !== 0) {
    return contents
  }

  const blockEnd = cursor - 1
  const before = contents.slice(0, braceStart + 1)
  const inside = contents.slice(braceStart + 1, blockEnd)
  const after = contents.slice(blockEnd)

  const cleanedInside = inside.replace(
    /\s*signingConfig\s+signingConfigs\.\w+\s*/g,
    '',
  )

  return before + cleanedInside + after
}

function withAndroidReleaseSigning(config, rawOptions = {}) {
  if (!isReleaseBuild()) {
    return config
  }

  const options = {
    ...DEFAULTS,
    ...rawOptions,
  }

  config = withGradleProperties(config, (innerConfig) => {
    const { modResults } = innerConfig
    ensureProperty(modResults, options.storeFileProperty, options.storeFile)
    ensureProperty(modResults, options.keyAliasProperty, options.keyAlias)
    if (options.storePassword !== undefined) {
      ensureProperty(
        modResults,
        options.storePasswordProperty,
        options.storePassword,
      )
    }
    if (options.keyPassword !== undefined) {
      ensureProperty(
        modResults,
        options.keyPasswordProperty,
        options.keyPassword,
      )
    }
    return innerConfig
  })

  return withAppBuildGradle(config, (innerConfig) => {
    let { contents } = innerConfig.modResults
    contents = injectReleaseSigningBlock(contents, options)
    contents = ensureReleaseSigningUsage(contents)
    contents = stripSigningConfigAssignments(contents)
    innerConfig.modResults.contents = contents
    return innerConfig
  })
}

module.exports = withAndroidReleaseSigning
