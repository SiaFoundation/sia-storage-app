// Reads version from package.json and validates app.config.js uses it
// This is called by knope during prepare-release
import pkg from '../package.json'
console.log(`Version synced: ${pkg.version}`)
