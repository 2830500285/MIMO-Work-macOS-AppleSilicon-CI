#!/usr/bin/env node

const { execFileSync, spawn } = require('node:child_process')
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs')
const http = require('node:http')
const { join, resolve } = require('node:path')

const EXPECTED_PRODUCT_NAME = 'MIMO Work'
const EXPECTED_BUNDLE_ID = 'com.mimowork.desktop'
const EXPECTED_RUNTIME_BINARY = 'Contents/Resources/MIMO-Work-Core/packages/opencode/dist/mimocode-darwin-arm64/bin/mimo'
const EXPECTED_BETTER_SQLITE_BINARY = 'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
const SETTINGS_FILE_NAME = 'mimo-work-settings.json'
const DEFAULT_PORT = 8899
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_EXPECTED_REPLY = 'MIMO_WORK_SMOKE_OK'

function projectRoot() {
  return resolve(__dirname, '..')
}

function defaultAppCandidates(root = projectRoot()) {
  return [
    join(root, 'dist', 'mac-arm64', `${EXPECTED_PRODUCT_NAME}.app`),
    join(root, 'dist', 'macos-arm64-dir-script', 'mac-arm64', `${EXPECTED_PRODUCT_NAME}.app`),
    join(root, 'dist', 'macos-arm64-dir', 'mac-arm64', `${EXPECTED_PRODUCT_NAME}.app`)
  ]
}

function parseArgs(argv) {
  const options = {
    app: process.env.MIMO_WORK_SMOKE_APP || '',
    staticOnly: false,
    skipPrompt: false,
    keepData: false,
    port: Number(process.env.MIMO_WORK_SMOKE_PORT || DEFAULT_PORT),
    timeoutMs: Number(process.env.MIMO_WORK_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    expectedReply: process.env.MIMO_WORK_SMOKE_EXPECTED_REPLY || DEFAULT_EXPECTED_REPLY
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--app') {
      options.app = argv[++i] || ''
    } else if (arg === '--static-only') {
      options.staticOnly = true
    } else if (arg === '--skip-prompt') {
      options.skipPrompt = true
    } else if (arg === '--keep-data') {
      options.keepData = true
    } else if (arg === '--port') {
      options.port = Number(argv[++i] || DEFAULT_PORT)
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i] || DEFAULT_TIMEOUT_MS)
    } else if (arg === '--expected-reply') {
      options.expectedReply = argv[++i] || DEFAULT_EXPECTED_REPLY
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid --port: ${options.port}`)
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${options.timeoutMs}`)
  }
  return options
}

function usage() {
  return [
    'Usage: npm run smoke:mac:arm64 -- --app "dist/.../MIMO Work.app" [--static-only]',
    '',
    'Full smoke must run on Apple Silicon and requires MIMO_WORK_MIMO_API_KEY in the environment.',
    'The script never prints the key and writes smoke data under this project work/ directory.'
  ].join('\n')
}

function resolveAppPath(rawAppPath, root = projectRoot()) {
  if (rawAppPath) {
    return resolve(root, rawAppPath)
  }
  const candidate = defaultAppCandidates(root).find((item) => existsSync(item))
  if (!candidate) {
    throw new Error(`No ${EXPECTED_PRODUCT_NAME}.app found. Checked:\n${defaultAppCandidates(root).join('\n')}`)
  }
  return candidate
}

function execText(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function plistValue(appPath, key, execFile = execFileSync) {
  return execFile('/usr/libexec/PlistBuddy', ['-c', `Print:${key}`, join(appPath, 'Contents', 'Info.plist')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function binaryArchs(path, execFile = execFileSync) {
  return execFile('lipo', ['-archs', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim().split(/\s+/).filter(Boolean)
}

function assertArm64Binary(path, label, execFile = execFileSync) {
  const archs = binaryArchs(path, execFile)
  if (!archs.includes('arm64')) {
    throw new Error(`${label} is not arm64: ${path} (${archs.join(' ') || 'unknown'})`)
  }
  return archs
}

function iconSize(appPath, execFile = execFileSync) {
  const output = execFile('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(appPath, 'Contents', 'Resources', 'icon.icns')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] || 0)
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] || 0)
  return { width, height }
}

function runStaticChecks(appPath, deps = {}) {
  const execFile = deps.execFileSync || execFileSync
  const executable = join(appPath, 'Contents', 'MacOS', EXPECTED_PRODUCT_NAME)
  const runtimeBinary = join(appPath, EXPECTED_RUNTIME_BINARY)
  const sqliteBinary = join(appPath, EXPECTED_BETTER_SQLITE_BINARY)
  const topLevelKunRuntime = join(appPath, 'Contents', 'Resources', 'kun')
  const messages = []

  assertExists(appPath, 'app bundle')
  if (!statSync(appPath).isDirectory()) {
    throw new Error(`App path is not a directory: ${appPath}`)
  }
  assertExists(executable, 'app executable')
  assertExists(runtimeBinary, 'darwin arm64 MiMo runtime')
  assertExists(sqliteBinary, 'better-sqlite3 native addon')
  assertExists(join(appPath, 'Contents', 'Resources', 'icon.icns'), 'macOS icon')

  const displayName = plistValue(appPath, 'CFBundleDisplayName', execFile)
  const bundleName = plistValue(appPath, 'CFBundleName', execFile)
  const executableName = plistValue(appPath, 'CFBundleExecutable', execFile)
  const bundleId = plistValue(appPath, 'CFBundleIdentifier', execFile)
  if (displayName !== EXPECTED_PRODUCT_NAME) throw new Error(`Unexpected CFBundleDisplayName: ${displayName}`)
  if (bundleName !== EXPECTED_PRODUCT_NAME) throw new Error(`Unexpected CFBundleName: ${bundleName}`)
  if (executableName !== EXPECTED_PRODUCT_NAME) throw new Error(`Unexpected CFBundleExecutable: ${executableName}`)
  if (bundleId !== EXPECTED_BUNDLE_ID) throw new Error(`Unexpected CFBundleIdentifier: ${bundleId}`)

  messages.push(`bundle id: ${bundleId}`)
  messages.push(`app archs: ${assertArm64Binary(executable, 'app executable', execFile).join(' ')}`)
  messages.push(`runtime archs: ${assertArm64Binary(runtimeBinary, 'MiMo runtime', execFile).join(' ')}`)
  messages.push(`better-sqlite3 archs: ${assertArm64Binary(sqliteBinary, 'better-sqlite3 native addon', execFile).join(' ')}`)

  if (existsSync(topLevelKunRuntime)) {
    throw new Error(`Unexpected legacy top-level Kun runtime bundle: ${topLevelKunRuntime}`)
  }

  const icon = iconSize(appPath, execFile)
  if (icon.width < 512 || icon.height < 512) {
    throw new Error(`macOS icon is too small: ${icon.width}x${icon.height}`)
  }
  messages.push(`icon: ${icon.width}x${icon.height}`)

  try {
    execFile('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    messages.push('codesign verify: ok')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`codesign verification failed: ${message}`)
  }

  try {
    execFile('spctl', ['--assess', '--type', 'execute', appPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    messages.push('spctl assess: accepted')
  } catch {
    messages.push('spctl assess: rejected (expected for unsigned/not-notarized local builds)')
  }

  return messages
}

function hostSupportsAppleSilicon(options = {}) {
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const execFile = options.execFileSync || execFileSync
  const execOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  if (platform !== 'darwin') return false
  if (arch === 'arm64') return true

  try {
    if (String(execFile('sysctl', ['-n', 'hw.optional.arm64'], execOptions)).trim() === '1') {
      return true
    }
  } catch {
    // Continue to uname fallback.
  }

  try {
    return String(execFile('uname', ['-m'], execOptions)).trim() === 'arm64'
  } catch {
    return false
  }
}

function redact(text) {
  const secret = process.env.MIMO_WORK_MIMO_API_KEY
  if (!secret) return text
  return text.split(secret).join('<redacted>')
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function httpJson(url, options = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = http.request(url, {
      method: options.method || 'GET',
      timeout: options.timeoutMs || 5_000,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed = null
        try {
          parsed = raw ? JSON.parse(raw) : null
        } catch {
          parsed = raw
        }
        if ((res.statusCode || 500) >= 400) {
          const message = typeof parsed?.message === 'string' ? parsed.message : raw
          rejectRequest(new Error(`HTTP ${res.statusCode}: ${redact(message)}`))
          return
        }
        resolveRequest(parsed)
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error(`Timed out requesting ${url}`))
    })
    req.on('error', rejectRequest)
    if (body) req.write(body)
    req.end()
  })
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const health = await httpJson(`${baseUrl}/health`, { timeoutMs: 2_000 })
      if (health?.status === 'ok' && health?.service === 'mimo-work') return health
      lastError = JSON.stringify(health)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(1_000)
  }
  throw new Error(`MIMO Work health did not become ready: ${redact(lastError)}`)
}

function collectAssistantText(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  return turns
    .flatMap((turn) => Array.isArray(turn.items) ? turn.items : [])
    .filter((item) => item?.kind === 'assistant_text' || item?.kind === 'assistant_text_delta')
    .map((item) => typeof item.text === 'string' ? item.text : '')
    .join('\n')
}

function collectErrors(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  return turns
    .flatMap((turn) => Array.isArray(turn.items) ? turn.items : [])
    .filter((item) => item?.kind === 'error')
    .map((item) => typeof item.message === 'string' ? item.message : JSON.stringify(item))
}

async function runPromptSmoke(baseUrl, options) {
  const thread = await httpJson(`${baseUrl}/v1/threads`, {
    method: 'POST',
    body: {
      title: 'MIMO Work macOS arm64 smoke',
      workspace: options.workspace
    }
  })
  const threadId = thread?.id
  if (!threadId) throw new Error('Thread creation did not return an id')

  await httpJson(`${baseUrl}/v1/threads/${encodeURIComponent(threadId)}/turns`, {
    method: 'POST',
    body: {
      prompt: `Reply with exactly this text and no extra words: ${options.expectedReply}`,
      displayText: `Smoke reply check: ${options.expectedReply}`,
      mode: 'build',
      workspace: options.workspace
    }
  })

  const deadline = Date.now() + options.timeoutMs
  let lastText = ''
  while (Date.now() < deadline) {
    const current = await httpJson(`${baseUrl}/v1/threads/${encodeURIComponent(threadId)}`, { timeoutMs: 10_000 })
    const errors = collectErrors(current)
    if (errors.length > 0) {
      throw new Error(`Prompt failed: ${redact(errors.join('; '))}`)
    }
    lastText = collectAssistantText(current)
    if (lastText.includes(options.expectedReply)) {
      return { threadId, text: lastText }
    }
    await sleep(2_000)
  }
  throw new Error(`Prompt did not produce expected reply "${options.expectedReply}". Last assistant text: ${redact(lastText)}`)
}

function prepareSmokeSettings(root, options) {
  const smokeRoot = resolve(process.env.MIMO_WORK_SMOKE_DATA_DIR || join(root, 'work', `smoke-mac-arm64-${Date.now()}`))
  const userData = join(smokeRoot, 'user-data')
  const workspace = join(smokeRoot, 'workspace')
  const writeWorkspace = join(smokeRoot, 'write-workspace')
  const runtimeData = join(smokeRoot, 'runtime-data')
  mkdirSync(userData, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(writeWorkspace, { recursive: true })
  mkdirSync(runtimeData, { recursive: true })
  writeFileSync(join(userData, SETTINGS_FILE_NAME), `${JSON.stringify({
    version: 1,
    workspaceRoot: workspace,
    agents: {
      kun: {
        runtimeEngine: 'mimo-work',
        port: options.port,
        autoStart: true,
        dataDir: runtimeData,
        mimo: {
          model: process.env.MIMO_WORK_SMOKE_MODEL || 'mimo-v2.5-pro'
        }
      }
    },
    write: {
      defaultWorkspaceRoot: writeWorkspace,
      activeWorkspaceRoot: writeWorkspace,
      workspaces: [writeWorkspace]
    },
    appBehavior: {
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    }
  }, null, 2)}\n`, 'utf8')
  return { smokeRoot, userData, workspace }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolveWait) => {
    const timer = setTimeout(resolveWait, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveWait()
    })
  })
}

async function runRuntimeSmoke(appPath, options) {
  if (!hostSupportsAppleSilicon()) {
    throw new Error('Full runtime smoke requires an Apple Silicon macOS host. This host cannot execute a darwin arm64 app.')
  }
  if (!options.skipPrompt && !process.env.MIMO_WORK_MIMO_API_KEY?.trim()) {
    throw new Error('Full prompt smoke requires MIMO_WORK_MIMO_API_KEY in the environment. The value will not be printed or written to settings.')
  }

  const root = projectRoot()
  const executable = join(appPath, 'Contents', 'MacOS', EXPECTED_PRODUCT_NAME)
  const smoke = prepareSmokeSettings(root, options)
  const baseUrl = `http://127.0.0.1:${options.port}`
  let stderrTail = ''
  const child = spawn(executable, ['--user-data-dir', smoke.userData], {
    cwd: smoke.workspace,
    env: {
      ...process.env,
      MIMO_WORK_MIMO_API_KEY: process.env.MIMO_WORK_MIMO_API_KEY || '',
      MIMO_WORK_SMOKE_AUTOSTART: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })

  child.stderr.on('data', (chunk) => {
    stderrTail = redact(`${stderrTail}${chunk.toString('utf8')}`).slice(-12_000)
  })

  try {
    await waitForHealth(baseUrl, options.timeoutMs)
    if (options.skipPrompt) {
      return { health: true, prompt: false, smokeRoot: smoke.smokeRoot }
    }
    const prompt = await runPromptSmoke(baseUrl, {
      workspace: smoke.workspace,
      expectedReply: options.expectedReply,
      timeoutMs: options.timeoutMs
    })
    return { health: true, prompt, smokeRoot: smoke.smokeRoot }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}${stderrTail ? `\nApp stderr tail:\n${stderrTail}` : ''}`)
  } finally {
    child.kill('SIGTERM')
    await waitForExit(child, 5_000)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (!options.keepData) {
      rmSync(smoke.smokeRoot, { recursive: true, force: true })
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return
  }
  const appPath = resolveAppPath(options.app)
  console.log(`[smoke:mac:arm64] app=${appPath}`)
  for (const message of runStaticChecks(appPath)) {
    console.log(`[smoke:mac:arm64] ${message}`)
  }
  if (options.staticOnly) {
    console.log('[smoke:mac:arm64] static checks passed')
    return
  }

  const result = await runRuntimeSmoke(appPath, options)
  console.log('[smoke:mac:arm64] health passed')
  if (result.prompt) {
    console.log(`[smoke:mac:arm64] prompt passed: ${result.prompt.threadId}`)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[smoke:mac:arm64] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}

module.exports = {
  DEFAULT_EXPECTED_REPLY,
  DEFAULT_PORT,
  EXPECTED_BETTER_SQLITE_BINARY,
  EXPECTED_BUNDLE_ID,
  EXPECTED_PRODUCT_NAME,
  EXPECTED_RUNTIME_BINARY,
  _internals: {
    collectAssistantText,
    defaultAppCandidates,
    hostSupportsAppleSilicon,
    parseArgs,
    prepareSmokeSettings,
    resolveAppPath,
    runStaticChecks
  }
}
