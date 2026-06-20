#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { join, resolve } = require('node:path')

const RUNTIME_PACKAGE_NAME = '@mimo-ai/mimocode-darwin-arm64'
const DEFAULT_RUNTIME_VERSION = '0.1.1'
const RUNTIME_RELATIVE_BINARY = 'packages/opencode/dist/mimocode-darwin-arm64/bin/mimo'

function envValue(name) {
  const value = process.env[name]
  return value !== undefined && value !== '' ? value : undefined
}

function projectRoot() {
  return resolve(__dirname, '..')
}

function preparedCoreDir(root = projectRoot()) {
  return resolve(envValue('MIMO_WORK_PREPARED_CORE_DIR') || join(root, 'work', 'mimo-runtime-core', 'MIMO-Work-Core'))
}

function runtimePackageSpec() {
  return `${RUNTIME_PACKAGE_NAME}@${envValue('MIMO_WORK_MIMOCODE_DARWIN_ARM64_VERSION') || DEFAULT_RUNTIME_VERSION}`
}

function sourceCorePackageJson(root = projectRoot()) {
  const sourceCoreDir = resolve(envValue('MIMO_WORK_CORE_SOURCE_DIR') || join(root, '..', 'MIMO-Work-Core'))
  const sourcePackageJson = join(sourceCoreDir, 'package.json')
  return existsSync(sourcePackageJson) ? sourcePackageJson : null
}

function ensureCorePackageJson(targetCoreDir, root = projectRoot()) {
  mkdirSync(targetCoreDir, { recursive: true })
  const sourcePackageJson = sourceCorePackageJson(root)
  if (sourcePackageJson) {
    copyFileSync(sourcePackageJson, join(targetCoreDir, 'package.json'))
    return
  }
  writeFileSync(
    join(targetCoreDir, 'package.json'),
    `${JSON.stringify({ name: 'MIMO-Work-Core', private: true }, null, 2)}\n`,
    'utf8'
  )
}

function binaryArchs(binaryPath, execFile = execFileSync) {
  try {
    return execFile('lipo', ['-archs', binaryPath], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean)
  } catch {
    return []
  }
}

function hasArm64Binary(binaryPath, execFile = execFileSync) {
  return existsSync(binaryPath) && binaryArchs(binaryPath, execFile).includes('arm64')
}

function prepareMimoRuntime(options = {}) {
  const root = resolve(options.root || projectRoot())
  const execFile = options.execFileSync || execFileSync
  const targetCoreDir = resolve(options.targetCoreDir || preparedCoreDir(root))
  const targetBinary = join(targetCoreDir, RUNTIME_RELATIVE_BINARY)
  const force = envValue('MIMO_WORK_MIMOCODE_RUNTIME_FORCE') === '1'

  if (!force && hasArm64Binary(targetBinary, execFile)) {
    console.log(`[prepare-mimo-runtime] Reusing ${targetBinary}`)
    return { coreDir: targetCoreDir, binary: targetBinary, reused: true }
  }

  const packageSpec = runtimePackageSpec()
  const scratchDir = join(root, 'work', '.mimo-runtime-packages')
  rmSync(scratchDir, { recursive: true, force: true })
  mkdirSync(scratchDir, { recursive: true })

  console.log(`[prepare-mimo-runtime] Fetching ${packageSpec}`)
  const packed = execFile('npm', ['pack', packageSpec, '--pack-destination', scratchDir], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim().split(/\r?\n/).filter(Boolean).pop()
  if (!packed) {
    throw new Error(`npm pack did not return a tarball name for ${packageSpec}`)
  }

  const tarball = join(scratchDir, packed)
  execFile('tar', ['-xzf', tarball, '-C', scratchDir], { stdio: 'inherit' })

  const extractedBinary = join(scratchDir, 'package', 'bin', 'mimo')
  if (!existsSync(extractedBinary)) {
    throw new Error(`Downloaded ${packageSpec} does not contain bin/mimo`)
  }

  ensureCorePackageJson(targetCoreDir, root)
  mkdirSync(join(targetCoreDir, 'packages', 'opencode', 'dist', 'mimocode-darwin-arm64', 'bin'), {
    recursive: true
  })
  copyFileSync(extractedBinary, targetBinary)
  execFile('chmod', ['755', targetBinary], { stdio: 'inherit' })
  rmSync(scratchDir, { recursive: true, force: true })

  const archs = binaryArchs(targetBinary, execFile)
  if (!archs.includes('arm64')) {
    throw new Error(`Prepared MiMo runtime is not arm64: ${targetBinary} (${archs.join(' ') || 'unknown'})`)
  }

  console.log(`[prepare-mimo-runtime] Prepared ${targetBinary}`)
  return { coreDir: targetCoreDir, binary: targetBinary, reused: false }
}

if (require.main === module) {
  try {
    const result = prepareMimoRuntime()
    console.log(`[prepare-mimo-runtime] MIMO_WORK_CORE_DIR=${result.coreDir}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

module.exports = {
  DEFAULT_RUNTIME_VERSION,
  RUNTIME_PACKAGE_NAME,
  RUNTIME_RELATIVE_BINARY,
  _internals: {
    binaryArchs,
    hasArm64Binary,
    preparedCoreDir,
    prepareMimoRuntime,
    runtimePackageSpec,
    sourceCorePackageJson
  }
}
