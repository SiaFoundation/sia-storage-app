const { execSync } = require('child_process')

module.exports = async function() {
  try {
    require('better-sqlite3')
  } catch (e) {
    if (e.message.includes('NODE_MODULE_VERSION')) {
      console.log(
        '\nbetter-sqlite3 binary is stale — rebuilding for current Node.js...\n'
      )
      execSync('npm rebuild better-sqlite3', {
        stdio: 'inherit',
        cwd: __dirname,
      })
    } else {
      throw e
    }
  }
}
