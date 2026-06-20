const { spawnSync } = require('node:child_process')

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  })
}

// MIMO Work may spawn local runtime helpers with the Electron binary
// (ELECTRON_RUN_AS_NODE) and resolves
// better-sqlite3 from the root node_modules, so the native module must match
// Electron's ABI — the node-ABI prebuild that `npm install` fetches cannot be
// loaded there. Best
// effort: a failure (e.g. offline) keeps the JSONL fallback working.
const { join } = require('node:path')
try {
  const electronVersion = require('electron/package.json').version
  const result = run('npx', [
    '--yes',
    'prebuild-install',
    `--runtime=electron`,
    `--target=${electronVersion}`
  ], { cwd: join(__dirname, '..', 'node_modules', 'better-sqlite3') })
  if (result.status !== 0) {
    console.warn('[postinstall] better-sqlite3 electron prebuild failed; MIMO Work will use the JSONL fallback')
  }
} catch (error) {
  console.warn('[postinstall] skipped better-sqlite3 electron prebuild:', error.message)
}
