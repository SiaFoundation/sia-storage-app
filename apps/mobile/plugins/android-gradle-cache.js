const { withGradleProperties } = require('@expo/config-plugins')

function withAndroidGradleCache(config) {
  return withGradleProperties(config, (innerConfig) => {
    const { modResults } = innerConfig

    setProperty(modResults, 'org.gradle.caching', 'true')
    setProperty(modResults, 'reactNativeArchitectures', 'armeabi-v7a,arm64-v8a')

    return innerConfig
  })
}

function setProperty(modResults, key, value) {
  const existing = modResults.find((item) => item.type === 'property' && item.key === key)
  if (existing) {
    existing.value = value
  } else {
    modResults.push({ type: 'property', key, value })
  }
}

module.exports = withAndroidGradleCache
