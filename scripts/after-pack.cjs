const { execFileSync } = require('node:child_process')
const { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const MIMO_CORE_REQUIRED_PATHS = [
  'MIMO-Work-Core/package.json',
  'MIMO-Work-Core/packages/opencode/dist'
]

const MIMO_CORE_WINDOWS_RUNTIME_BINARY_CANDIDATES = {
  x64: [
    'MIMO-Work-Core/packages/opencode/dist/mimocode-windows-x64/bin/mimo.exe',
    'MIMO-Work-Core/packages/opencode/dist/mimocode-windows-x64-baseline/bin/mimo.exe'
  ]
}
const WINDOWS_X64_CANVAS_NATIVE_PACKAGE = 'canvas-win32-x64-msvc'

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  if (arch === 'ia32' || arch === 0) return 'ia32'
  return String(arch || '')
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function unpackedAppRoot(context) {
  return join(packedResourcesDir(context), 'app.asar.unpacked')
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function assertOneExists(paths, label) {
  if (paths.some((path) => existsSync(path))) return
  throw new Error(`[after-pack] Missing ${label}; expected one of:\n${paths.join('\n')}`)
}

function npmCommand(args, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args]
    }
  }
  return { command: 'npm', args }
}

function validateBundledMimoRuntime(context) {
  const root = unpackedAppRoot(context)
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  const resources = packedResourcesDir(context)
  for (const relativePath of MIMO_CORE_REQUIRED_PATHS) {
    assertExists(join(resources, relativePath), relativePath)
  }
  if (normalizePlatform(context.electronPlatformName) === 'win32') {
    const arch = normalizeArch(context.arch)
    const candidates = MIMO_CORE_WINDOWS_RUNTIME_BINARY_CANDIDATES[arch]
    if (!candidates) {
      throw new Error(`[after-pack] Unsupported Windows architecture for MIMO Work runtime: ${arch || context.arch}`)
    }
    assertOneExists(
      candidates.map((relativePath) => join(resources, relativePath)),
      `Windows ${arch} MiMo-Code runtime binary`
    )
  }
}

function sourceMimoCoreDir() {
  return process.env.MIMO_WORK_CORE_DIR || join(__dirname, '..', '..', 'MIMO-Work-Core')
}

function ensureBundledMimoRuntime(context) {
  const resources = packedResourcesDir(context)
  const target = join(resources, 'MIMO-Work-Core')
  if (existsSync(join(target, 'packages', 'opencode', 'dist'))) return

  const source = sourceMimoCoreDir()
  assertExists(join(source, 'package.json'), 'source MIMO-Work-Core package.json')
  assertExists(join(source, 'packages', 'opencode', 'dist'), 'source MIMO-Work-Core opencode dist')

  mkdirSync(target, { recursive: true })
  mkdirSync(join(target, 'packages', 'opencode'), { recursive: true })
  copyFileSync(join(source, 'package.json'), join(target, 'package.json'))
  cpSync(
    join(source, 'packages', 'opencode', 'dist'),
    join(target, 'packages', 'opencode', 'dist'),
    { recursive: true }
  )
}

function pruneWindowsHostNativeOptionalModules(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'win32') return
  if (normalizeArch(context.arch) !== 'x64') return

  const napiRsDir = join(unpackedAppRoot(context), 'node_modules', '@napi-rs')
  if (!existsSync(napiRsDir)) return

  for (const entry of readdirSync(napiRsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('canvas-')) continue
    if (entry.name === WINDOWS_X64_CANVAS_NATIVE_PACKAGE) continue
    rmSync(join(napiRsDir, entry.name), { recursive: true, force: true })
  }
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = appBundlePath(context)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

async function afterPack(context) {
  ensureBundledMimoRuntime(context)
  pruneWindowsHostNativeOptionalModules(context)
  validateBundledMimoRuntime(context)
  maybeAdhocSignMacApp(context)
}

module.exports = afterPack
module.exports.default = afterPack
module.exports.MIMO_CORE_REQUIRED_PATHS = MIMO_CORE_REQUIRED_PATHS
module.exports.MIMO_CORE_WINDOWS_RUNTIME_BINARY_CANDIDATES = MIMO_CORE_WINDOWS_RUNTIME_BINARY_CANDIDATES
module.exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  npmCommand,
  ensureBundledMimoRuntime,
  normalizeArch,
  pruneWindowsHostNativeOptionalModules,
  sourceMimoCoreDir,
  validateBundledMimoRuntime
}
