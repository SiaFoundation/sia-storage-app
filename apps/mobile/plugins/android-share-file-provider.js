const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs/promises')
const path = require('path')

// Override react-native-share's default FileProvider paths to include
// <files-path>, allowing sharing of files from Context.getFilesDir().
// Without this, Share.open() fails on Android with a null URI error
// because the library's default only covers Download/ and cache/.
function withShareFileProvider(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      await fs.mkdir(xmlDir, { recursive: true })

      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="rnshare1" path="Download/" />
    <cache-path name="rnshare2" path="/" />
    <files-path name="internal_files" path="." />
</paths>
`
      await fs.writeFile(path.join(xmlDir, 'share_download_paths.xml'), xmlContent, 'utf-8')

      return config
    },
  ])
}

module.exports = withShareFileProvider
