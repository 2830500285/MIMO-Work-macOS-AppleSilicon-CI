import { app } from 'electron'
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, get as httpGet, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { URL } from 'node:url'
import {
  CODE_MIMO_WORK_EXECUTION_GUARDRAILS,
  getModelProviderProfile,
  getKunRuntimeSettings,
  mimoCredentialAuthContent,
  mimoCredentialProviderConfigPatch,
  normalizeMimoCredentialSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { redactSecretText } from '../../shared/secret-redaction'
import { getKunBaseUrl } from '../kun-base-url'
import { guiSkillRootsForRuntime, listGuiSkills } from '../services/skill-service'
import type { ManagedRuntimeAdapter } from './kun-adapter'

export const MIMO_WORK_RUNTIME_ID = 'mimo-work' as const
const STARTUP_TIMEOUT_MS = 180_000
const STOP_GRACE_MS = 5_000
const STDERR_TAIL_MAX_CHARS = 32_768
const EVENT_REPLAY_LIMIT = 500
const STALLED_SHORT_COMMAND_MS = 30_000
const STALLED_INSTALL_COMMAND_MS = 45_000
const FAILED_TOOL_RECOVERY_GRACE_MS = 15_000
const CORE_LOG_RETENTION_MS = 2 * 24 * 60 * 60 * 1_000
const CORE_LOG_MAX_BYTES = 50 * 1024 * 1024
const CORE_ENV_ALLOWLIST = [
  'HOME',
  'PATH',
  'Path',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'LOGNAME',
  'SHELL',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy'
] as const
const SYNTHETIC_QUESTION_FOLLOWUP_MARKER = '用户已经回答了上一轮未能完成的 question 工具提问。'
const MIMO_WORK_BUILD_TOOL_ALLOWLIST = [
  'bash',
  'read',
  'glob',
  'grep',
  'edit',
  'actor',
  'fetch',
  'search',
  'code',
  'skill',
  'changedir',
  'question',
  'plan',
  'memory',
  'history',
  'task'
]
const MIMO_WORK_REQUEST_TOOL_OVERRIDES = {
  write: false
} as const

let child: ChildProcess | null = null
let startPromise: Promise<void> | null = null
let stderrTail = ''
let adapterServer: Server | null = null
let activeMimoBaseUrl = ''
const latestSeq = new Map<string, number>()
const replayEvents = new Map<string, Record<string, unknown>[]>()
const messageRoleById = new Map<string, string>()
const partMessageRoleById = new Map<string, string>()
const partTypeById = new Map<string, string>()
const partTextById = new Map<string, string>()
const partRawTextById = new Map<string, string>()
const partFingerprintById = new Map<string, string>()
const pendingQuestionFingerprintById = new Map<string, string>()
const recoveredStalledRuntimeTools = new Set<string>()
const autoApprovedPermissionIds = new Set<string>()
const syntheticQuestionInputs = new Map<string, {
  threadId: string
  questions: Array<Record<string, unknown>>
}>()
const resolvedSyntheticQuestionInputs = new Map<string, {
  threadId: string
  status: 'submitted' | 'cancelled'
  answers?: unknown[]
}>()
const localGoals = new Map<string, Record<string, unknown>>()
const localTodos = new Map<string, Record<string, unknown>>()
const localAttachments = new Map<string, LocalAttachmentRecord>()
const localMemories = new Map<string, LocalMemoryRecord>()
const localThreadMetadata = new Map<string, LocalThreadMetadataRecord>()
const adapterStartedAt = new Date().toISOString()
let localStatePath = ''
let lastInjectedMemoryIds: string[] = []
const pendingSnapshotSinceByThread = new Map<string, number>()
const completedSnapshotMessages = new Set<string>()
const failedSnapshotMessages = new Set<string>()

type LocalAttachmentRecord = {
  id: string
  name: string
  mimeType: string
  byteSize: number
  hash: string
  width?: number
  height?: number
  localFilePath?: string
  textFallback?: Record<string, unknown>
  threadIds?: string[]
  workspaces?: string[]
  createdAt: string
  updatedAt: string
  dataBase64: string
}

type LocalMemoryRecord = {
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  workspace?: string
  project?: string
  sourceThreadId?: string
  sourceTurnId?: string
  tags?: string[]
  confidence?: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

type LocalThreadMetadataRecord = {
  id: string
  workspace: string
  title?: string
  createdAt: string
  updatedAt: string
}

type MimoLaunch = { command: string; args: string[]; cwd?: string }

export type MimoWorkUnexpectedExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

let onUnexpectedMimoWorkExit: ((info: MimoWorkUnexpectedExitInfo) => void) | null = null

export function setMimoWorkUnexpectedExitHandler(
  handler: ((info: MimoWorkUnexpectedExitInfo) => void) | null
): void {
  onUnexpectedMimoWorkExit = handler
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

function expandHome(value: string): string {
  return value.replace(/^~(?=$|[\\/])/, homedir())
}

function defaultMimoHome(settings: AppSettingsV1): string {
  const runtime = getKunRuntimeSettings(settings)
  return join(expandHome(runtime.dataDir), 'mimocode')
}

function defaultCoreDir(): string {
  return process.env.MIMO_WORK_CORE_DIR?.trim() || join(appRoot(), '..', 'MIMO-Work-Core')
}

function mimoCorePlatform(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'windows' : platform
}

function mimoCoreArch(arch: NodeJS.Architecture = process.arch): 'arm64' | 'x64' {
  return arch === 'arm64' ? 'arm64' : 'x64'
}

function mimoBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'mimo.exe' : 'mimo'
}

function mimoBinaryCandidates(
  coreDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string[] {
  const runtimePlatform = mimoCorePlatform(platform)
  const runtimeArch = mimoCoreArch(arch)
  const binary = mimoBinaryName(platform)
  const opencodeDir = join(coreDir, 'packages', 'opencode')
  return [
    join(opencodeDir, 'dist', `mimocode-${runtimePlatform}-${runtimeArch}`, 'bin', binary),
    join(opencodeDir, 'dist', `mimocode-${runtimePlatform}-${runtimeArch}-baseline`, 'bin', binary),
    join(coreDir, 'dist', `mimocode-${runtimePlatform}-${runtimeArch}`, 'bin', binary),
    join(coreDir, 'dist', `mimocode-${runtimePlatform}-${runtimeArch}-baseline`, 'bin', binary)
  ]
}

function bundledMimoBinary(
  coreDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string | null {
  const envBinary = process.env.MIMOCODE_BIN_PATH?.trim()
  if (envBinary && existsSync(envBinary)) return envBinary
  const candidates = mimoBinaryCandidates(coreDir, platform, arch)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveLaunch(
  settings: AppSettingsV1,
  port: number,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): MimoLaunch {
  const runtime = getKunRuntimeSettings(settings)
  const binary = runtime.binaryPath.trim()
  if (binary) {
    return {
      command: binary,
      args: ['serve', '--hostname', '127.0.0.1', '--port', String(port)]
    }
  }
  const coreDir = defaultCoreDir()
  const bundledBinary = bundledMimoBinary(coreDir, platform, arch)
  if (bundledBinary) {
    return {
      command: bundledBinary,
      args: ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      cwd: coreDir
    }
  }
  const opencodeDir = join(coreDir, 'packages', 'opencode')
  return {
    command: process.env.BUN_BIN?.trim() || 'bun',
    args: ['run', '--cwd', opencodeDir, '--conditions=browser', 'src/index.ts', 'serve', '--hostname', '127.0.0.1', '--port', String(port)],
    cwd: existsSync(coreDir) ? coreDir : undefined
  }
}

function defaultPathForPlatform(platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem'
    : '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
}

function childIsRunning(): boolean {
  return child !== null && child.exitCode === null && child.signalCode === null
}

function appendTail(current: string, nextChunk: string): string {
  const combined = `${current}${redactSecretText(nextChunk)}`
  return combined.length > STDERR_TAIL_MAX_CHARS
    ? combined.slice(-STDERR_TAIL_MAX_CHARS)
    : combined
}

function mimoCoreChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtimeEnv: NodeJS.ProcessEnv,
  isolatedHome?: string,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of CORE_ENV_ALLOWLIST) {
    const value = baseEnv[key]
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }
  env.PATH = env.PATH || env.Path || defaultPathForPlatform(platform)
  delete env.Path
  env.HOME = isolatedHome || env.HOME || env.USERPROFILE || homedir()
  env.LANG = env.LANG || 'C.UTF-8'
  return {
    ...env,
    ...(isolatedHome
      ? {
          XDG_CONFIG_HOME: join(isolatedHome, '.config'),
          XDG_CACHE_HOME: join(isolatedHome, '.cache'),
          XDG_DATA_HOME: join(isolatedHome, '.local', 'share')
        }
      : {}),
    ...runtimeEnv
  }
}

function mimoRuntimeSpawnOptions(
  launch: MimoLaunch,
  mimoHome: string,
  env: NodeJS.ProcessEnv
): SpawnOptions {
  return {
    cwd: launch.cwd ?? mimoHome,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
    env
  }
}

async function pruneMimoCoreLogs(mimoHome: string): Promise<void> {
  const logDir = join(mimoHome, 'data', 'log')
  const now = Date.now()
  const entries = await readdir(logDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.log')) return
    const filePath = join(logDir, entry.name)
    const info = await stat(filePath).catch(() => null)
    if (!info) return
    const tooOld = now - info.mtimeMs > CORE_LOG_RETENTION_MS
    const tooLarge = info.size > CORE_LOG_MAX_BYTES
    if (!tooOld && !tooLarge) return
    await rm(filePath, { force: true }).catch(() => undefined)
  }))
}

function waitForExit(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) {
      resolve()
      return
    }
    process.once('exit', () => resolve())
  })
}

async function reserveLocalPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo | null
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  if (!address?.port) {
    throw new Error('Unable to reserve a local port for MiMo-Code runtime.')
  }
  return address.port
}

function isMimoHttpReady(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      resolve(ready)
    }
    const req = httpGet(new URL('/session', baseUrl), (res) => {
      res.resume()
      finish((res.statusCode ?? 500) < 500)
    })
    req.setTimeout(1_000, () => {
      req.destroy()
      finish(false)
    })
    req.once('error', () => finish(false))
  })
}

export const mimoWorkRuntimeAdapter: ManagedRuntimeAdapter = {
  id: MIMO_WORK_RUNTIME_ID,

  async resolveExecutable(settings: AppSettingsV1): Promise<string> {
    const launch = resolveLaunch(settings, 0)
    return [launch.command, ...launch.args].join(' ')
  },

  async ensureRunning(settings: AppSettingsV1): Promise<void> {
    if (childIsRunning()) return
    if (startPromise) return startPromise
    startPromise = startMimoRuntime(settings).finally(() => {
      startPromise = null
    })
    return startPromise
  },

  async stopAndWait(): Promise<void> {
    const server = adapterServer
    adapterServer = null
    activeMimoBaseUrl = ''
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
    const current = child
    child = null
    if (!current || current.exitCode !== null || current.signalCode !== null) return
    current.kill('SIGTERM')
    const force = setTimeout(() => {
      if (current.exitCode === null && current.signalCode === null) {
        current.kill('SIGKILL')
      }
    }, STOP_GRACE_MS)
    try {
      await waitForExit(current)
    } finally {
      clearTimeout(force)
    }
  },

  isChildRunning(): boolean {
    return childIsRunning()
  },

  getBaseUrl(settings: AppSettingsV1): string {
    const runtime = getKunRuntimeSettings(settings)
    return getKunBaseUrl(runtime.port)
  },

  async reclaimPort(_port: number): Promise<{ ok: true } | { ok: false; message: string }> {
    return { ok: true }
  },

  async resolveAvailablePort(port: number): Promise<{ port: number; changed: boolean; message?: string }> {
    return { port, changed: false }
  }
}

async function startMimoRuntime(settings: AppSettingsV1): Promise<void> {
  const mimo = effectiveMimoCredentials(settings)
  const configContent = await mimoWorkCoreConfigContent(settings, mimo)
  const mimoPort = await reserveLocalPort()
  const launch = resolveLaunch(settings, mimoPort)
  const expectedMimoBaseUrl = `http://127.0.0.1:${mimoPort}`
  const mimoHome = defaultMimoHome(settings)
  const isolatedHome = join(mimoHome, 'home')
  await mkdir(mimoHome, { recursive: true })
  await mkdir(isolatedHome, { recursive: true })
  await mkdir(join(mimoHome, 'data', 'log'), { recursive: true })
  await pruneMimoCoreLogs(mimoHome)
  await loadLocalAdapterState(settings)
  stderrTail = ''

  const mimoBaseUrl = await new Promise<string>((resolve, reject) => {
    let settled = false
    let proc: ChildProcess | null = null
    let probing = false
    let readinessProbe: NodeJS.Timeout | null = null
    const timeout = setTimeout(() => {
      finish(new Error(`MiMo-Code runtime did not become ready before timeout. ${stderrTail}`))
    }, STARTUP_TIMEOUT_MS)

    const finish = (error?: Error, baseUrl?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (readinessProbe) clearInterval(readinessProbe)
      if (error) {
        if (proc && child === proc) child = null
        if (proc && proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGTERM')
        }
        reject(error)
        return
      }
      resolve(baseUrl ?? expectedMimoBaseUrl)
    }

    const probeReady = (): void => {
      if (probing) return
      probing = true
      void isMimoHttpReady(expectedMimoBaseUrl)
        .then((ready) => {
          if (ready) finish(undefined, expectedMimoBaseUrl)
        })
        .finally(() => {
          probing = false
        })
    }

    proc = spawn(launch.command, launch.args, mimoRuntimeSpawnOptions(
      launch,
      mimoHome,
      mimoCoreChildEnv(process.env, {
        MIMOCODE_HOME: mimoHome,
        MIMOCODE_CLIENT: 'desktop',
        MIMOCODE_AUTH_CONTENT: JSON.stringify(mimoCredentialAuthContent(mimo)),
        MIMOCODE_CONFIG_CONTENT: JSON.stringify(configContent)
      }, isolatedHome)
    ))
    proc.unref()
    child = proc
    readinessProbe = setInterval(probeReady, 250)
    probeReady()

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = redactSecretText(chunk.toString('utf8'))
      const match = text.match(/mimocode server listening on (http:\/\/127\.0\.0\.1:\d+)/i)
      if (match) {
        finish(undefined, match[1])
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk.toString('utf8'))
    })
    proc.once('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
    proc.once('exit', (code, signal) => {
      const wasActiveChild = child === proc
      if (wasActiveChild) child = null
      if (!settled) {
        finish(new Error(`MiMo-Code runtime exited before ready (code=${code ?? 'null'}, signal=${signal ?? 'null'}). ${stderrTail}`))
      } else if (wasActiveChild) {
        onUnexpectedMimoWorkExit?.({ code, signal, stderrTail })
      }
    })
  })
  activeMimoBaseUrl = mimoBaseUrl
  await startCompatibilityServer(settings, mimoBaseUrl)
}

async function startCompatibilityServer(settings: AppSettingsV1, mimoBaseUrl: string): Promise<void> {
  if (adapterServer) return
  const runtime = getKunRuntimeSettings(settings)
  adapterServer = createServer((req, res) => {
    void handleCompatibilityRequest(req, res, settings, mimoBaseUrl).catch((error) => {
      writeJson(res, 500, {
        code: 'mimo_work_adapter_failed',
        message: error instanceof Error ? redactSecretText(error.message) : redactSecretText(String(error))
      })
    })
  })
  await new Promise<void>((resolve, reject) => {
    adapterServer?.once('error', reject)
    adapterServer?.listen(runtime.port, '127.0.0.1', () => resolve())
  })
}

async function handleCompatibilityRequest(
  req: IncomingMessage,
  res: ServerResponse,
  settings: AppSettingsV1,
  mimoBaseUrl: string
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, { status: 'ok', service: 'mimo-work', mode: 'adapter', core: activeMimoBaseUrl || mimoBaseUrl })
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/runtime/info') {
    writeJson(res, 200, runtimeInfo(settings))
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/runtime/tools') {
    writeJson(res, 200, { providers: [{ id: 'xiaomi', name: 'MiMo' }], mcpServers: [], mcpSearch: { enabled: false, active: false } })
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/skills') {
    const skills = await listGuiSkills(settings)
    writeJson(res, 200, skills.ok ? { skills: skills.skills } : { skills: [] })
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/usage') {
    writeJson(res, 200, await usageResponse(mimoBaseUrl, url, settings))
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/attachments/diagnostics') {
    writeJson(res, 200, attachmentDiagnostics(settings))
    return
  }
  if (req.method === 'POST' && url.pathname === '/v1/attachments') {
    const body = await readJsonBody(req)
    const attachment = await createLocalAttachment(settings, body)
    if (!attachment) {
      writeJson(res, 400, { code: 'validation_error', message: 'attachment upload requires name and dataBase64' })
      return
    }
    writeJson(res, 201, { attachment: attachmentMetadata(attachment) })
    return
  }
  const attachmentContentMatch = url.pathname.match(/^\/v1\/attachments\/([^/]+)\/content$/)
  if (attachmentContentMatch && req.method === 'GET') {
    const attachment = localAttachments.get(decodeURIComponent(attachmentContentMatch[1]))
    if (!attachment) {
      writeJson(res, 404, { code: 'not_found', message: 'attachment not found' })
      return
    }
    writeJson(res, 200, { attachment: attachmentMetadata(attachment), dataBase64: attachment.dataBase64 })
    return
  }
  const attachmentMatch = url.pathname.match(/^\/v1\/attachments\/([^/]+)$/)
  if (attachmentMatch && req.method === 'GET') {
    const attachment = localAttachments.get(decodeURIComponent(attachmentMatch[1]))
    if (!attachment) {
      writeJson(res, 404, { code: 'not_found', message: 'attachment not found' })
      return
    }
    writeJson(res, 200, { attachment: attachmentMetadata(attachment) })
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/memory/diagnostics') {
    writeJson(res, 200, memoryDiagnostics(settings))
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/memory') {
    writeJson(res, 200, { memories: listLocalMemories(url) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/v1/memory') {
    const memory = await createLocalMemory(await readJsonBody(req))
    if (!memory) {
      writeJson(res, 400, { code: 'validation_error', message: 'memory request must include content' })
      return
    }
    writeJson(res, 201, { memory })
    return
  }
  const memoryMatch = url.pathname.match(/^\/v1\/memory\/([^/]+)$/)
  if (memoryMatch && req.method === 'PATCH') {
    const memory = await patchLocalMemory(decodeURIComponent(memoryMatch[1]), await readJsonBody(req))
    if (!memory) {
      writeJson(res, 404, { code: 'not_found', message: 'memory not found' })
      return
    }
    writeJson(res, 200, { memory })
    return
  }
  if (memoryMatch && req.method === 'DELETE') {
    const memory = await deleteLocalMemory(decodeURIComponent(memoryMatch[1]))
    if (!memory) {
      writeJson(res, 404, { code: 'not_found', message: 'memory not found' })
      return
    }
    writeJson(res, 200, { memory })
    return
  }
  if (req.method === 'GET' && url.pathname === '/v1/threads') {
    writeJson(res, 200, { threads: await listThreadSummaries(settings, mimoBaseUrl, url) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/v1/threads') {
    const body = await readJsonBody(req)
    const workspace = normalizeAdapterWorkspace(settings, stringField(body, 'workspace'))
    const session = await mimoJson(mimoBaseUrl, '/session', {
      method: 'POST',
      body: JSON.stringify({ title: stringField(body, 'title') || undefined }),
      // Creating a MiMo-Code session with a workspace header can deadlock a
      // long-lived packaged core after it has restored existing project
      // instances. Bind the workspace in the adapter and use it for follow-up
      // runtime calls instead.
      headers: mimoHeaders()
    })
    upsertLocalThreadMetadata(settings, session, workspace, stringField(body, 'title'))
    await persistLocalAdapterState()
    writeJson(res, 200, { ...sessionToThread(settings, session), turns: [], latestSeq: latestSeq.get(asId(session)) ?? 0 })
    return
  }
  const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/)
  if (threadMatch && req.method === 'GET') {
    const threadId = decodeURIComponent(threadMatch[1])
    const headers = mimoHeaders()
    const session = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}`, { headers })
    upsertLocalThreadMetadata(settings, session)
    const messages = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/message`, { headers })
    const pendingQuestions = await listPendingQuestionsForThread(mimoBaseUrl, threadId)
    await autoApprovePendingPermissionsForThread(settings, mimoBaseUrl, threadId)
    await recoverStalledRuntimeToolParts({
      settings,
      mimoBaseUrl,
      threadId,
      messages: Array.isArray(messages) ? messages : []
    })
    await persistLocalAdapterState()
    const turns = messagesToTurns(settings, threadId, Array.isArray(messages) ? messages : [], pendingQuestions)
    writeJson(res, 200, {
      ...sessionToThread(settings, session),
      turns: appendPendingQuestionItemsToTurns(threadId, turns, pendingQuestions),
      latestSeq: latestSeq.get(threadId) ?? 0
    })
    return
  }
  if (threadMatch && req.method === 'PATCH') {
    const threadId = decodeURIComponent(threadMatch[1])
    const body = await readJsonBody(req)
    const workspace = normalizeAdapterWorkspace(settings, stringField(body, 'workspace') || threadWorkspace(settings, threadId))
    const patch: Record<string, unknown> = {}
    const title = stringField(body, 'title')
    if (title) patch.title = title
    const status = stringField(body, 'status')
    if (status === 'archived') patch.time = { archived: Date.now() }
    if (status === 'idle') patch.time = { archived: undefined }
    const session = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: mimoHeaders()
    })
    upsertLocalThreadMetadata(settings, session, workspace, title)
    await persistLocalAdapterState()
    writeJson(res, 200, sessionToThread(settings, session))
    return
  }
  if (threadMatch && req.method === 'DELETE') {
    const threadId = decodeURIComponent(threadMatch[1])
    await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}`, {
      method: 'DELETE',
      headers: mimoHeaders()
    })
    localGoals.delete(threadId)
    localTodos.delete(threadId)
    localThreadMetadata.delete(threadId)
    await persistLocalAdapterState()
    writeJson(res, 200, { id: threadId, deleted: true })
    return
  }
  const forkMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/fork$/)
  if (forkMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(forkMatch[1])
    const body = await readJsonBody(req)
    const workspace = threadWorkspace(settings, threadId)
    const fork = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/fork`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: mimoHeaders()
    })
    const forkId = asId(fork)
    const title = stringField(body, 'title')
    const titledFork = title && forkId !== 'unknown'
      ? await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(forkId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title }),
          headers: mimoHeaders()
        })
      : fork
    upsertLocalThreadMetadata(settings, titledFork, workspace, title)
    await persistLocalAdapterState()
    writeJson(res, 201, sessionToThread(settings, titledFork))
    return
  }
  const goalMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/goal$/)
  if (goalMatch && req.method === 'GET') {
    const threadId = decodeURIComponent(goalMatch[1])
    const coreGoal = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/goal`, {
      headers: mimoHeaders()
    })
    const goal = mapMimoGoal(threadId, coreGoal) ?? localGoals.get(threadId) ?? null
    writeJson(res, 200, { goal })
    return
  }
  if (goalMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(goalMatch[1])
    const body = await readJsonBody(req)
    const objective = stringField(body, 'objective')
    if (objective) {
      await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/goal`, {
        method: 'POST',
        body: JSON.stringify({ condition: objective }),
        headers: mimoHeaders()
      })
    }
    const goal = upsertLocalGoal(threadId, body)
    if (!goal) {
      writeJson(res, 400, { code: 'validation_error', message: 'goal request must include an objective before status-only updates' })
      return
    }
    writeJson(res, 200, { goal })
    return
  }
  if (goalMatch && req.method === 'DELETE') {
    const threadId = decodeURIComponent(goalMatch[1])
    await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/goal`, {
      method: 'DELETE',
      headers: mimoHeaders()
    })
    const cleared = localGoals.delete(threadId)
    writeJson(res, 200, { cleared: cleared || true })
    return
  }
  const todosMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/todos$/)
  if (todosMatch && req.method === 'GET') {
    const threadId = decodeURIComponent(todosMatch[1])
    const local = localTodos.get(threadId)
    if (local) {
      writeJson(res, 200, { todos: local })
      return
    }
    const mimoTodos = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/todo`, {
      headers: mimoHeaders()
    })
    writeJson(res, 200, { todos: mapMimoTodos(threadId, Array.isArray(mimoTodos) ? mimoTodos : []) })
    return
  }
  if (todosMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(todosMatch[1])
    const body = await readJsonBody(req)
    const inputTodos = Array.isArray(body.todos) ? body.todos : []
    const coreTodos = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/todo`, {
      method: 'POST',
      body: JSON.stringify({ todos: kunTodosToMimoTodos(inputTodos) }),
      headers: mimoHeaders()
    })
    const todos = setLocalTodos(threadId, Array.isArray(coreTodos) ? coreTodos : inputTodos)
    writeJson(res, 200, { todos })
    return
  }
  if (todosMatch && req.method === 'DELETE') {
    const threadId = decodeURIComponent(todosMatch[1])
    await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/todo`, {
      method: 'DELETE',
      headers: mimoHeaders()
    })
    const cleared = localTodos.delete(threadId)
    writeJson(res, 200, { cleared: cleared || true })
    return
  }
  const turnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns$/)
  if (turnMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(turnMatch[1])
    const body = await readJsonBody(req)
    const workspace = threadWorkspace(settings, threadId, stringField(body, 'workspace'))
    const prompt = promptFromBody(body)
    if (!prompt.trim()) {
      writeJson(res, 400, { code: 'validation_error', message: 'turn request must include a prompt' })
      return
    }
    const visiblePrompt = visiblePromptFromBody(body, prompt)
    const mimo = effectiveMimoCredentials(settings)
    pendingSnapshotSinceByThread.set(threadId, Date.now() - 5_000)
    try {
      await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/prompt_async`, {
        method: 'POST',
        body: JSON.stringify({
          parts: buildPromptParts(body, withWorkspaceRuntimePrompt(settings, workspace, prompt)),
          agent: body?.mode === 'plan' ? 'plan' : 'build',
          model: { providerID: 'xiaomi', modelID: mimo.model },
          source: 'user',
          tools: MIMO_WORK_REQUEST_TOOL_OVERRIDES
        }),
        headers: mimoHeaders()
      })
    } catch (error) {
      pendingSnapshotSinceByThread.delete(threadId)
      throw error
    }
    const now = new Date().toISOString()
    const turnId = `mimo_turn_${Date.now()}`
    writeJson(res, 200, {
      turn: {
        id: turnId,
        threadId,
        status: 'queued',
        prompt: visiblePrompt,
        model: mimo.model,
        attachmentIds: stringArrayField(body, 'attachmentIds'),
        createdAt: now,
        items: [{
          id: `mimo_user_${Date.now()}`,
          turnId,
          threadId,
          role: 'user',
          status: 'completed',
          createdAt: now,
          kind: 'user_message',
          text: visiblePrompt,
          attachmentIds: stringArrayField(body, 'attachmentIds')
        }]
      }
    })
    return
  }
  const interruptMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns\/[^/]+\/interrupt$/)
  if (interruptMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(interruptMatch[1])
    await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/abort`, {
      method: 'POST',
      headers: mimoHeaders()
    })
    writeJson(res, 200, { ok: true })
    return
  }
  const compactMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/compact$/)
  if (compactMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(compactMatch[1])
    const mimo = effectiveMimoCredentials(settings)
    await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/summarize`, {
      method: 'POST',
      body: JSON.stringify({ providerID: 'xiaomi', modelID: mimo.model, auto: false }),
      headers: mimoHeaders()
    })
    writeJson(res, 200, { ok: true })
    return
  }
  const reviewMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/review$/)
  if (reviewMatch && req.method === 'POST') {
    const threadId = decodeURIComponent(reviewMatch[1])
    const body = await readJsonBody(req)
    const workspace = threadWorkspace(settings, threadId, stringField(body, 'workspace'))
    const prompt = reviewPrompt(asRecord(body.target))
    const mimo = effectiveMimoCredentials(settings)
    pendingSnapshotSinceByThread.set(threadId, Date.now() - 5_000)
    try {
      await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/prompt_async`, {
        method: 'POST',
        body: JSON.stringify({
          parts: buildPromptParts(body, withWorkspaceRuntimePrompt(settings, workspace, prompt)),
          agent: 'build',
          model: { providerID: 'xiaomi', modelID: stringField(body, 'model') || mimo.model },
          source: 'user',
          tools: MIMO_WORK_REQUEST_TOOL_OVERRIDES
        }),
        headers: mimoHeaders()
      })
    } catch (error) {
      pendingSnapshotSinceByThread.delete(threadId)
      throw error
    }
    const now = new Date().toISOString()
    const turnId = `mimo_review_${Date.now()}`
    writeJson(res, 202, {
      threadId,
      turnId,
      userMessageItemId: `${turnId}_user`,
      reviewItemId: `${turnId}_review`,
      createdAt: now
    })
    return
  }
  const diffMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/diff$/)
  if (diffMatch && req.method === 'GET') {
    const threadId = decodeURIComponent(diffMatch[1])
    const diff = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/diff${url.search}`, {
      headers: mimoHeaders()
    })
    writeJson(res, 200, { diff })
    return
  }
  const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/)
  if (approvalMatch && req.method === 'POST') {
    const approvalId = decodeURIComponent(approvalMatch[1])
    const body = await readJsonBody(req)
    const decision = stringField(body, 'decision') === 'allow' ? 'allow' : 'deny'
    await replyToMimoPermission(mimoBaseUrl, approvalId, decision, stringField(body, 'reason') || undefined)
    writeJson(res, 200, { approvalId, decision, status: decision === 'allow' ? 'allowed' : 'denied' })
    return
  }
  const userInputMatch = url.pathname.match(/^\/v1\/user-inputs?\/([^/]+)$/)
  if (userInputMatch && req.method === 'POST') {
    const inputId = decodeURIComponent(userInputMatch[1])
    const body = await readJsonBody(req)
    const syntheticInput = syntheticQuestionInputs.get(inputId)
    if (body.cancelled === true) {
      if (syntheticInput) {
        syntheticQuestionInputs.delete(inputId)
        resolvedSyntheticQuestionInputs.set(inputId, {
          threadId: syntheticInput.threadId,
          status: 'cancelled'
        })
        pendingQuestionFingerprintById.delete(partTypeKey(syntheticInput.threadId, inputId))
        writeJson(res, 200, { inputId, status: 'cancelled', synthetic: true })
        return
      }
      await mimoJson(mimoBaseUrl, `/question/${encodeURIComponent(inputId)}/reject`, { method: 'POST' })
      writeJson(res, 200, { inputId, status: 'cancelled' })
      return
    }
    if (syntheticInput) {
      const rawAnswers = Array.isArray(body.answers) ? body.answers : []
      const workspace = threadWorkspace(settings, syntheticInput.threadId)
      const prompt = syntheticQuestionFollowupPrompt(syntheticInput.questions, rawAnswers)
      const mimo = effectiveMimoCredentials(settings)
      pendingSnapshotSinceByThread.set(syntheticInput.threadId, Date.now() - 5_000)
      try {
        await abortThreadRun(mimoBaseUrl, settings, syntheticInput.threadId)
        await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(syntheticInput.threadId)}/prompt_async`, {
          method: 'POST',
          body: JSON.stringify({
            parts: buildPromptParts({}, withWorkspaceRuntimePrompt(settings, workspace, prompt)),
            agent: 'build',
            model: { providerID: 'xiaomi', modelID: mimo.model },
            source: 'user',
            tools: MIMO_WORK_REQUEST_TOOL_OVERRIDES
          }),
          headers: mimoHeaders()
        })
      } catch (error) {
        pendingSnapshotSinceByThread.delete(syntheticInput.threadId)
        throw error
      }
      syntheticQuestionInputs.delete(inputId)
      resolvedSyntheticQuestionInputs.set(inputId, {
        threadId: syntheticInput.threadId,
        status: 'submitted',
        answers: rawAnswers
      })
      pendingQuestionFingerprintById.delete(partTypeKey(syntheticInput.threadId, inputId))
      writeJson(res, 200, { inputId, status: 'submitted', answers: body.answers ?? [], synthetic: true })
      return
    }
    const answers = kunAnswersToMimoAnswers(Array.isArray(body.answers) ? body.answers : [])
    await mimoJson(mimoBaseUrl, `/question/${encodeURIComponent(inputId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
      headers: { 'Content-Type': 'application/json' }
    })
    writeJson(res, 200, { inputId, status: 'submitted', answers: body.answers ?? [] })
    return
  }
  const eventMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/events$/)
  if (eventMatch && req.method === 'GET') {
    await streamThreadEvents(req, res, settings, mimoBaseUrl, decodeURIComponent(eventMatch[1]))
    return
  }
  writeJson(res, 404, { code: 'not_found', message: `MIMO Work adapter has no route for ${req.method} ${url.pathname}` })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (!chunks.length) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function adapterStateFile(settings: AppSettingsV1): string {
  const runtime = getKunRuntimeSettings(settings)
  return join(expandHome(runtime.dataDir), 'mimo-work-adapter-state.json')
}

async function loadLocalAdapterState(settings: AppSettingsV1): Promise<void> {
  localStatePath = adapterStateFile(settings)
  await mkdir(expandHome(getKunRuntimeSettings(settings).dataDir), { recursive: true })
  localAttachments.clear()
  localMemories.clear()
  localThreadMetadata.clear()
  let raw = ''
  try {
    raw = await readFile(localStatePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const parsed = asRecord(JSON.parse(raw) as unknown)
  if (Array.isArray(parsed.attachments)) {
    for (const item of parsed.attachments) {
      const attachment = parseLocalAttachment(item)
      if (attachment) localAttachments.set(attachment.id, attachment)
    }
  }
  if (Array.isArray(parsed.memories)) {
    for (const item of parsed.memories) {
      const memory = parseLocalMemory(item)
      if (memory) localMemories.set(memory.id, memory)
    }
  }
  if (Array.isArray(parsed.threads)) {
    for (const item of parsed.threads) {
      const thread = parseLocalThreadMetadata(settings, item)
      if (thread) localThreadMetadata.set(thread.id, thread)
    }
  }
}

async function persistLocalAdapterState(): Promise<void> {
  if (!localStatePath) return
  await writeFile(localStatePath, JSON.stringify({
    attachments: [...localAttachments.values()],
    memories: [...localMemories.values()],
    threads: [...localThreadMetadata.values()]
  }, null, 2))
}

function parseLocalAttachment(value: unknown): LocalAttachmentRecord | null {
  const record = asRecord(value)
  const id = stringField(record, 'id')
  const name = stringField(record, 'name')
  const mimeType = stringField(record, 'mimeType')
  const dataBase64 = stringField(record, 'dataBase64')
  if (!id || !name || !mimeType || !dataBase64) return null
  return {
    id,
    name,
    mimeType,
    dataBase64,
    byteSize: numberField(record, 'byteSize') ?? Buffer.from(dataBase64, 'base64').byteLength,
    hash: stringField(record, 'hash') || sha256Base64(dataBase64),
    width: numberField(record, 'width'),
    height: numberField(record, 'height'),
    localFilePath: stringField(record, 'localFilePath') || undefined,
    textFallback: Object.keys(asRecord(record.textFallback)).length ? asRecord(record.textFallback) : undefined,
    threadIds: stringArray(record.threadIds),
    workspaces: stringArray(record.workspaces),
    createdAt: stringField(record, 'createdAt') || new Date().toISOString(),
    updatedAt: stringField(record, 'updatedAt') || new Date().toISOString()
  }
}

function parseLocalMemory(value: unknown): LocalMemoryRecord | null {
  const record = asRecord(value)
  const id = stringField(record, 'id')
  const content = stringField(record, 'content')
  if (!id || !content) return null
  return {
    id,
    content,
    scope: normalizeMemoryScope(stringField(record, 'scope')),
    workspace: stringField(record, 'workspace') || undefined,
    project: stringField(record, 'project') || undefined,
    sourceThreadId: stringField(record, 'sourceThreadId') || undefined,
    sourceTurnId: stringField(record, 'sourceTurnId') || undefined,
    tags: stringArray(record.tags),
    confidence: numberField(record, 'confidence'),
    createdAt: stringField(record, 'createdAt') || new Date().toISOString(),
    updatedAt: stringField(record, 'updatedAt') || new Date().toISOString(),
    disabledAt: stringField(record, 'disabledAt') || undefined,
    deletedAt: stringField(record, 'deletedAt') || undefined
  }
}

function parseLocalThreadMetadata(settings: AppSettingsV1, value: unknown): LocalThreadMetadataRecord | null {
  const record = asRecord(value)
  const id = stringField(record, 'id')
  const workspace = normalizeAdapterWorkspace(settings, stringField(record, 'workspace'))
  if (!id || !workspace) return null
  return {
    id,
    workspace,
    title: stringField(record, 'title') || undefined,
    createdAt: stringField(record, 'createdAt') || new Date().toISOString(),
    updatedAt: stringField(record, 'updatedAt') || new Date().toISOString()
  }
}

function normalizeAdapterWorkspace(settings: AppSettingsV1, workspace?: string): string {
  const raw = (workspace || settings.workspaceRoot || homedir()).trim()
  return expandHome(raw || homedir())
}

function sessionDirectory(value: unknown): string {
  return stringField(asRecord(value), 'directory')
}

function isMimoRuntimeDirectory(directory: string): boolean {
  const normalized = directory.replaceAll('\\', '/')
  return normalized.includes('/MIMO-Work-Core')
    || normalized.includes('/MIMO Work.app/Contents/Resources/MIMO-Work-Core')
    || normalized.includes('/.mimo-work/')
}

function displayWorkspaceForSession(settings: AppSettingsV1, session: unknown): string {
  const id = asId(session)
  const stored = id !== 'unknown' ? localThreadMetadata.get(id)?.workspace : ''
  if (stored) return stored
  const directory = sessionDirectory(session)
  if (directory && !isMimoRuntimeDirectory(directory)) {
    return normalizeAdapterWorkspace(settings, directory)
  }
  return normalizeAdapterWorkspace(settings)
}

function threadWorkspace(settings: AppSettingsV1, threadId: string, fallback?: string): string {
  return localThreadMetadata.get(threadId)?.workspace || normalizeAdapterWorkspace(settings, fallback)
}

function upsertLocalThreadMetadata(
  settings: AppSettingsV1,
  session: unknown,
  fallbackWorkspace?: string,
  fallbackTitle?: string
): LocalThreadMetadataRecord | null {
  const id = asId(session)
  if (id === 'unknown') return null
  const now = new Date().toISOString()
  const existing = localThreadMetadata.get(id)
  const directory = sessionDirectory(session)
  const workspace = existing?.workspace
    || (directory && !isMimoRuntimeDirectory(directory)
      ? normalizeAdapterWorkspace(settings, directory)
      : normalizeAdapterWorkspace(settings, fallbackWorkspace))
  const title = stringField(asRecord(session), 'title') || fallbackTitle || existing?.title
  const record: LocalThreadMetadataRecord = {
    id,
    workspace,
    title,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
  localThreadMetadata.set(id, record)
  return record
}

async function createLocalAttachment(settings: AppSettingsV1, body: Record<string, unknown>): Promise<LocalAttachmentRecord | null> {
  const name = stringField(body, 'name')
  const dataBase64 = stringField(body, 'dataBase64')
  if (!name || !dataBase64) return null
  const bytes = Buffer.from(dataBase64, 'base64')
  if (!bytes.byteLength) return null
  const now = new Date().toISOString()
  const hash = createHash('sha256').update(bytes).digest('hex')
  const threadId = stringField(body, 'threadId')
  const workspace = stringField(body, 'workspace')
  const textFallback = asRecord(body.textFallback)
  const attachment: LocalAttachmentRecord = {
    id: `att_${Date.now()}_${hash.slice(0, 10)}`,
    name,
    mimeType: stringField(body, 'mimeType') || 'application/octet-stream',
    byteSize: bytes.byteLength,
    hash,
    width: numberField(body, 'width'),
    height: numberField(body, 'height'),
    localFilePath: stringField(body, 'localFilePath') || undefined,
    textFallback: Object.keys(textFallback).length ? textFallback : undefined,
    threadIds: threadId ? [threadId] : undefined,
    workspaces: workspace ? [workspace] : undefined,
    createdAt: now,
    updatedAt: now,
    dataBase64
  }
  localAttachments.set(attachment.id, attachment)
  await persistLocalAdapterState()
  return attachment
}

function attachmentMetadata(attachment: LocalAttachmentRecord): Record<string, unknown> {
  const { dataBase64: _dataBase64, ...metadata } = attachment
  return metadata
}

function attachmentDiagnostics(settings: AppSettingsV1): Record<string, unknown> {
  const totalBytes = [...localAttachments.values()].reduce((sum, attachment) => sum + attachment.byteSize, 0)
  return {
    enabled: true,
    rootDir: expandHome(getKunRuntimeSettings(settings).dataDir),
    count: localAttachments.size,
    totalBytes
  }
}

function listLocalMemories(url: URL): LocalMemoryRecord[] {
  const workspace = url.searchParams.get('workspace')?.trim() || ''
  const includeDeleted = url.searchParams.get('include_deleted') === 'true'
  return [...localMemories.values()]
    .filter((memory) => includeDeleted || !memory.deletedAt)
    .filter((memory) => memoryMatchesWorkspace(memory, workspace))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function createLocalMemory(body: Record<string, unknown>): Promise<LocalMemoryRecord | null> {
  const content = stringField(body, 'content')
  if (!content) return null
  const now = new Date().toISOString()
  const memory: LocalMemoryRecord = {
    id: `mem_${Date.now()}_${shortHash(content)}`,
    content,
    scope: normalizeMemoryScope(stringField(body, 'scope')),
    workspace: stringField(body, 'workspace') || undefined,
    project: stringField(body, 'project') || undefined,
    sourceThreadId: stringField(body, 'sourceThreadId') || undefined,
    sourceTurnId: stringField(body, 'sourceTurnId') || undefined,
    tags: stringArray(body.tags),
    confidence: numberField(body, 'confidence'),
    createdAt: now,
    updatedAt: now
  }
  localMemories.set(memory.id, memory)
  await persistLocalAdapterState()
  return memory
}

async function patchLocalMemory(memoryId: string, body: Record<string, unknown>): Promise<LocalMemoryRecord | null> {
  const memory = localMemories.get(memoryId)
  if (!memory) return null
  const content = stringField(body, 'content')
  if (content) memory.content = content
  if ('tags' in body) memory.tags = stringArray(body.tags)
  const confidence = numberField(body, 'confidence')
  if (confidence !== undefined) memory.confidence = confidence
  if (body.disabled === true) {
    memory.disabledAt = new Date().toISOString()
  } else if (body.disabled === false) {
    delete memory.disabledAt
  }
  memory.updatedAt = new Date().toISOString()
  await persistLocalAdapterState()
  return memory
}

async function deleteLocalMemory(memoryId: string): Promise<LocalMemoryRecord | null> {
  const memory = localMemories.get(memoryId)
  if (!memory) return null
  const now = new Date().toISOString()
  memory.deletedAt = now
  memory.updatedAt = now
  await persistLocalAdapterState()
  return memory
}

function memoryDiagnostics(settings: AppSettingsV1): Record<string, unknown> {
  const memories = [...localMemories.values()]
  return {
    enabled: true,
    rootDir: expandHome(getKunRuntimeSettings(settings).dataDir),
    activeCount: memories.filter((memory) => !memory.deletedAt && !memory.disabledAt).length,
    tombstoneCount: memories.filter((memory) => Boolean(memory.deletedAt)).length,
    lastInjectedIds: lastInjectedMemoryIds
  }
}

function memoryMatchesWorkspace(memory: LocalMemoryRecord, workspace: string): boolean {
  if (!workspace || memory.scope === 'user') return true
  return !memory.workspace || memory.workspace === workspace
}

function normalizeMemoryScope(value: string): LocalMemoryRecord['scope'] {
  if (value === 'workspace' || value === 'project') return value
  return 'user'
}

function buildPromptParts(body: Record<string, unknown>, prompt: string): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = []
  const memoryText = injectedMemoryPromptText()
  if (memoryText) parts.push({ type: 'text', text: memoryText })
  parts.push({ type: 'text', text: prompt })
  for (const attachment of attachmentsForPrompt(stringArrayField(body, 'attachmentIds'))) {
    parts.push({
      id: attachment.id,
      type: 'file',
      mime: attachment.mimeType,
      filename: attachment.name,
      url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`
    })
  }
  return parts
}

function promptFromBody(body: Record<string, unknown>): string {
  return stringField(body, 'prompt') ||
    stringField(body, 'message') ||
    stringField(body, 'text') ||
    stringField(body, 'input')
}

function visiblePromptFromBody(body: Record<string, unknown>, prompt: string): string {
  return visibleUserPromptText(stringField(body, 'displayText') || prompt)
}

function visibleUserPromptText(text: string): string {
  const raw = text.trim()
  if (!raw) return ''
  const runtimeStripped = stripWorkspaceRuntimePrompt(raw).trim()
  if (runtimeStripped && runtimeStripped !== raw) return visibleUserPromptText(runtimeStripped)
  const currentUserRequest = currentUserRequestText(raw)
  if (currentUserRequest) return currentUserRequest
  const stripped = stripMimoWorkInternalText(raw).trim()
  if (stripped) return stripped
  return isInternalPromptWrapper(raw) ? '' : raw
}

function currentUserRequestText(text: string): string {
  const marker = '[Current user request]'
  const index = text.indexOf(marker)
  if (index < 0) return ''
  return text.slice(index + marker.length).trimStart()
}

function knowledgeBaseRuntimeLines(settings: AppSettingsV1): string[] {
  const dirs = getKunRuntimeSettings(settings).knowledgeBaseDirs
    .map((dir) => dir.trim())
    .filter(Boolean)
  if (!dirs.length) return []
  return [
    '- Local knowledge-base directories / 本地资料库目录:',
    ...dirs.map((dir) => `  - ${dir}`),
    '- These directories may include Obsidian vaults or wiki folders. Read them only when relevant to the current request.'
  ]
}

function withWorkspaceRuntimePrompt(workspace: string, prompt: string): string
function withWorkspaceRuntimePrompt(settings: AppSettingsV1, workspace: string, prompt: string): string
function withWorkspaceRuntimePrompt(
  settingsOrWorkspace: AppSettingsV1 | string,
  workspaceOrPrompt: string,
  maybePrompt?: string
): string {
  const settings = typeof settingsOrWorkspace === 'string' ? null : settingsOrWorkspace
  const workspace = typeof settingsOrWorkspace === 'string' ? settingsOrWorkspace : workspaceOrPrompt
  const prompt = typeof settingsOrWorkspace === 'string' ? workspaceOrPrompt : (maybePrompt ?? '')
  const normalized = workspace.trim()
  const knowledgeBaseLines = settings ? knowledgeBaseRuntimeLines(settings) : []
  if (!normalized && knowledgeBaseLines.length === 0) return prompt
  return [
    'MIMO Work runtime context / 本轮执行上下文:',
    ...(normalized
      ? [
          `- Workspace/project directory / 项目工作区: ${normalized}`,
          '- Treat this directory as the project root for this turn.'
        ]
      : []),
    ...knowledgeBaseLines,
    '- Current user request and current-turn answers have priority over prior memories, old checkpoints, and other sessions.',
    '- Do not use previous sessions, memory search results, or checkpoint files as confirmation for missing requirements in this turn.',
    '- 运行 bash/python/node 或生成文档、图表、数据文件时，请先 cd 到该目录，或使用该目录下的绝对路径。',
    '- Do not pass workdir/cwd fields to bash. Put the cd command inside the command string.',
    '- Save generated artifacts under this workspace unless the user explicitly asks for another location.',
    '',
    prompt
  ].join('\n')
}

function stripWorkspaceRuntimePrompt(prompt: string): string {
  const marker = 'MIMO Work runtime context / 本轮执行上下文:'
  if (!prompt.startsWith(marker)) return prompt
  const split = prompt.indexOf('\n\n')
  return split >= 0 ? prompt.slice(split + 2).trimStart() : prompt
}

function stripMimoWorkInternalText(text: string): string {
  let next = text.trimStart()
  if (!next) return ''
  next = stripLeadingRuntimeContextLeak(next)
  next = stripLeadingCodeManagedInstructions(next)
  next = stripLeadingCurrentUserRequest(next)
  return next
}

function isInternalPromptWrapper(text: string): boolean {
  return text.startsWith('MIMO Work runtime context / 本轮执行上下文:') ||
    text.startsWith('[Code managed instructions]') ||
    text.startsWith('MIMO Work execution guardrails:') ||
    text.startsWith('[Current user request]')
}

function stripLeadingRuntimeContextLeak(text: string): string {
  const marker = 'MIMO Work runtime context / 本轮执行上下文:'
  if (!text.startsWith(marker)) return text
  const currentRequestIndex = text.indexOf('\n[Current user request]')
  if (currentRequestIndex >= 0) return stripAfterCurrentUserRequestLine(text, currentRequestIndex)
  const stripped = stripWorkspaceRuntimePrompt(text)
  return stripped === text ? '' : stripped.trimStart()
}

function stripLeadingCodeManagedInstructions(text: string): string {
  const markers = [
    '[Code managed instructions]',
    'MIMO Work execution guardrails:'
  ]
  if (!markers.some((marker) => text.startsWith(marker))) return text
  const currentRequestIndex = text.indexOf('\n[Current user request]')
  if (currentRequestIndex >= 0) return stripAfterCurrentUserRequestLine(text, currentRequestIndex)
  return ''
}

function stripLeadingCurrentUserRequest(text: string): string {
  if (!text.startsWith('[Current user request]')) return text
  const lineEnd = text.indexOf('\n')
  return lineEnd >= 0 ? text.slice(lineEnd + 1).trimStart() : ''
}

function stripAfterCurrentUserRequestLine(text: string, currentRequestIndex: number): string {
  const afterRequestLine = text.indexOf('\n', currentRequestIndex + 1)
  return afterRequestLine >= 0 ? text.slice(afterRequestLine + 1).trimStart() : ''
}

function injectedMemoryPromptText(): string {
  const memories = [...localMemories.values()]
    .filter((memory) => !memory.deletedAt && !memory.disabledAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
  lastInjectedMemoryIds = memories.map((memory) => memory.id)
  if (!memories.length) return ''
  return [
    'MIMO Work memory:',
    ...memories.map((memory) => `- ${memory.content}`)
  ].join('\n')
}

function attachmentsForPrompt(attachmentIds: string[]): LocalAttachmentRecord[] {
  return attachmentIds
    .map((id) => localAttachments.get(id))
    .filter((attachment): attachment is LocalAttachmentRecord => Boolean(attachment))
}

function reviewPrompt(target: Record<string, unknown>): string {
  const kind = stringField(target, 'kind')
  if (kind === 'baseBranch') {
    const branch = stringField(target, 'branch')
    return branch ? `/review base ${branch}` : '/review'
  }
  if (kind === 'commit') {
    const sha = stringField(target, 'sha')
    return sha ? `/review commit ${sha}` : '/review'
  }
  if (kind === 'custom') {
    const instructions = stringField(target, 'instructions')
    return instructions ? `/review ${instructions}` : '/review'
  }
  return '/review'
}

function sha256Base64(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex')
}

function mimoHeaders(workspace?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(workspace ? { 'x-mimocode-directory': encodeURIComponent(workspace) } : {})
  }
}

async function mimoJson(
  mimoBaseUrl: string,
  pathAndQuery: string,
  init: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`${mimoBaseUrl}${pathAndQuery}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(init.method === 'POST' ? 60_000 : 15_000)
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`MiMo-Code ${pathAndQuery} failed with ${res.status}: ${redactSecretText(text)}`)
  }
  return text ? JSON.parse(text) as unknown : {}
}

async function abortThreadRun(
  mimoBaseUrl: string,
  settings: AppSettingsV1,
  threadId: string
): Promise<void> {
  await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/abort`, {
    method: 'POST',
    headers: mimoHeaders()
  }).catch(() => undefined)
}

async function listThreadSummaries(
  settings: AppSettingsV1,
  mimoBaseUrl: string,
  url: URL
): Promise<Record<string, unknown>[]> {
  const query = sessionListQuery(url)
  const byId = new Map<string, Record<string, unknown>>()
  const addSessions = async (init: RequestInit): Promise<void> => {
    const sessions = await mimoJson(mimoBaseUrl, `/session${query}`, init).catch(() => [])
    if (!Array.isArray(sessions)) return
    for (const raw of sessions) {
      const id = asId(raw)
      if (id === 'unknown' || byId.has(id)) continue
      upsertLocalThreadMetadata(settings, raw)
      byId.set(id, sessionToThread(settings, raw))
    }
  }

  await addSessions({ headers: mimoHeaders() })
  await persistLocalAdapterState()

  const includeArchived = url.searchParams.get('include_archived') === 'true'
  const archivedOnly = url.searchParams.get('archived_only') === 'true'
  const limit = numericSearchParam(url, 'limit') ?? 50
  return [...byId.values()]
    .filter((thread) => includeArchived || thread.status !== 'archived')
    .filter((thread) => !archivedOnly || thread.status === 'archived')
    .sort((a, b) => stringField(b, 'updatedAt').localeCompare(stringField(a, 'updatedAt')))
    .slice(0, limit)
}

function sessionListQuery(url: URL): string {
  const params = new URLSearchParams()
  const limit = url.searchParams.get('limit')
  if (limit) params.set('limit', limit)
  const search = url.searchParams.get('search')
  if (search) params.set('search', search)
  const start = url.searchParams.get('start')
  if (start) params.set('start', start)
  const roots = url.searchParams.get('roots')
  if (roots) params.set('roots', roots)
  const text = params.toString()
  return text ? `?${text}` : ''
}

function numericSearchParam(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function sessionToThread(settings: AppSettingsV1, value: unknown): Record<string, unknown> {
  const session = asRecord(value)
  const runtime = getKunRuntimeSettings(settings)
  const mimo = effectiveMimoCredentials(settings)
  const id = asId(session)
  const time = asRecord(session.time)
  const created = numberField(time, 'created') || Date.now()
  const updated = numberField(time, 'updated') || created
  const archived = numberField(time, 'archived')
  return {
    id,
    title: stringField(session, 'title') || id.slice(0, 8),
    workspace: displayWorkspaceForSession(settings, session),
    model: mimo.model,
    mode: 'agent',
    status: archived ? 'archived' : 'idle',
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    relation: stringField(session, 'parentID') ? 'fork' : 'primary',
    parentThreadId: stringField(session, 'parentID') || undefined,
    forkedFromThreadId: stringField(session, 'parentID') || undefined,
    goal: localGoals.get(id) || undefined,
    todos: localTodos.get(id) || undefined,
    createdAt: new Date(created).toISOString(),
    updatedAt: new Date(updated).toISOString()
  }
}

function messagesToTurns(
  settings: AppSettingsV1,
  threadId: string,
  messages: unknown[],
  pendingQuestions: Record<string, unknown>[] = []
): Record<string, unknown>[] {
  rememberResolvedSyntheticQuestionsFromMessages(threadId, messages)
  const turns = new Map<string, Record<string, unknown>>()
  const mimo = effectiveMimoCredentials(settings)
  for (const message of messages) {
    const record = asRecord(message)
    const info = asRecord(record.info)
    const id = asId(info)
    const createdAt = new Date(numberField(asRecord(info.time), 'created') || Date.now()).toISOString()
    const parts = Array.isArray(record.parts) ? record.parts : []
    if (info.role === 'user') {
      const prompt = visibleUserPromptText(messageText(parts))
      turns.set(id, {
        id,
        threadId,
        status: 'completed',
        prompt,
        model: mimo.model,
        createdAt,
        finishedAt: createdAt,
        items: [{
          id: `${id}_user`,
          turnId: id,
          threadId,
          role: 'user',
          status: 'completed',
          createdAt,
          finishedAt: createdAt,
          kind: 'user_message',
          text: prompt
        }]
      })
      continue
    }
    if (info.role !== 'assistant') continue
    const parentId = stringField(info, 'parentID') || id
    const turn = turns.get(parentId) ?? {
      id: parentId,
      threadId,
      status: 'completed',
      prompt: '',
      model: mimo.model,
      createdAt,
      finishedAt: createdAt,
      items: []
    }
    const items = Array.isArray(turn.items) ? turn.items as unknown[] : []
    for (const part of parts) {
      const item = partToTurnItem(threadId, parentId, createdAt, asRecord(part), pendingQuestions)
      if (item) items.push(item)
    }
    const errorMessage = assistantInfoErrorMessage(info)
    if (errorMessage) {
      items.push(assistantErrorTurnItem(threadId, parentId, id, createdAt, errorMessage))
      turn.status = 'failed'
    }
    turn.items = items
    turn.finishedAt = createdAt
    turns.set(parentId, turn)
  }
  return [...turns.values()]
}

function assistantErrorTurnItem(
  threadId: string,
  turnId: string,
  assistantMessageId: string,
  createdAt: string,
  message: string
): Record<string, unknown> {
  return {
    id: `${assistantMessageId}_error`,
    turnId,
    threadId,
    role: 'system',
    status: 'failed',
    createdAt,
    finishedAt: createdAt,
    kind: 'error',
    code: 'mimo_assistant_error',
    severity: 'error',
    message
  }
}

function rememberResolvedSyntheticQuestionsFromMessages(threadId: string, messages: unknown[]): void {
  for (let index = 0; index < messages.length; index += 1) {
    const message = asRecord(messages[index])
    const info = asRecord(message.info)
    if (info.role !== 'user') continue
    const parts = Array.isArray(message.parts) ? message.parts : []
    if (!stripWorkspaceRuntimePrompt(messageText(parts)).startsWith(SYNTHETIC_QUESTION_FOLLOWUP_MARKER)) continue

    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previous = asRecord(messages[previousIndex])
      const previousInfo = asRecord(previous.info)
      if (previousInfo.role !== 'assistant') continue
      const previousParts = Array.isArray(previous.parts) ? previous.parts : []
      for (const previousPart of previousParts) {
        const part = asRecord(previousPart)
        if (!isPendingQuestionToolPart(part) || !questionToolQuestions(part).length) continue
        const inputId = syntheticQuestionInputId(threadId, part)
        if (resolvedSyntheticQuestionInputs.has(inputId)) continue
        resolvedSyntheticQuestionInputs.set(inputId, { threadId, status: 'submitted' })
      }
    }
  }
}

function partToTurnItem(
  threadId: string,
  turnId: string,
  createdAt: string,
  part: Record<string, unknown>,
  pendingQuestions: Record<string, unknown>[] = []
): Record<string, unknown> | null {
  const id = stringField(part, 'id') || `${turnId}_${stringField(part, 'type') || 'part'}_${createdAt}`
  const type = stringField(part, 'type')
  if (type === 'text') {
    const text = stripMimoWorkInternalText(stringField(part, 'text'))
    if (!text) return null
    return { id, turnId, threadId, role: 'assistant', status: 'completed', createdAt, finishedAt: createdAt, kind: 'assistant_text', text }
  }
  if (type === 'reasoning') {
    const text = stripMimoWorkInternalText(stringField(part, 'text'))
    if (!text) return null
    return { id, turnId, threadId, role: 'assistant', status: 'completed', createdAt, finishedAt: createdAt, kind: 'assistant_reasoning', text }
  }
  if (type === 'tool') {
    return toolPartToTurnItem(threadId, turnId, createdAt, part, pendingQuestions)
  }
  return null
}

function toolPartToTurnItem(
  threadId: string,
  turnId: string,
  createdAt: string,
  part: Record<string, unknown>,
  pendingQuestions: Record<string, unknown>[] = []
): Record<string, unknown> | null {
  if (isRecoverableStalledToolPart(part)) {
    const id = stringField(part, 'id') || `${turnId}_write_${createdAt}`
    const callId = stringField(part, 'callID') || id
    const toolName = stringField(part, 'tool') || 'tool'
    return {
      id,
      turnId,
      threadId,
      role: 'tool',
      createdAt: toolTime(asRecord(part.state), 'start') ?? createdAt,
      toolName,
      callId,
      summary: toolName,
      arguments: asRecord(asRecord(part.state).input),
      toolKind: toolKindForMimoTool(toolName),
      status: 'failed',
      isError: true,
      finishedAt: new Date().toISOString(),
      kind: 'tool_result',
      output: {
        error: `The ${toolName} tool stalled. MIMO Work recovered the turn and asked MiMo-Code to continue with a fresh bash/python/node path.`
      }
    }
  }
  if (isPendingQuestionToolPart(part)) {
    if (hasMatchingPendingQuestion(part, pendingQuestions)) return null
    return syntheticQuestionToTurnItem(threadId, turnId, createdAt, part)
  }
  const id = stringField(part, 'id') || `${turnId}_tool_${createdAt}`
  const state = asRecord(part.state)
  const stateStatus = stringField(state, 'status')
  const toolName = stringField(part, 'tool') || 'tool'
  const callId = stringField(part, 'callID') || id
  const input = asRecord(state.input)
  const title = stringField(state, 'title') || toolDisplayTitle(toolName, input)
  const base = {
    id,
    turnId,
    threadId,
    role: 'tool',
    createdAt: toolTime(state, 'start') ?? createdAt,
    toolName,
    callId,
    summary: title,
    arguments: input,
    toolKind: toolKindForMimoTool(toolName)
  }
  if (stateStatus === 'completed') {
    return {
      ...base,
      status: 'completed',
      finishedAt: toolTime(state, 'end') ?? createdAt,
      kind: 'tool_result',
      output: {
        text: stringField(state, 'output'),
        metadata: asRecord(state.metadata),
        attachments: Array.isArray(state.attachments) ? state.attachments : undefined
      }
    }
  }
  if (stateStatus === 'error') {
    return {
      ...base,
      status: 'failed',
      isError: true,
      finishedAt: toolTime(state, 'end') ?? createdAt,
      kind: 'tool_result',
      output: { error: stringField(state, 'error') || 'Tool failed', metadata: asRecord(state.metadata) }
    }
  }
  return {
    ...base,
    status: 'running',
    kind: 'tool_call',
    output: stateStatus === 'pending' ? { raw: stringField(state, 'raw') } : undefined
  }
}

function toolTime(state: Record<string, unknown>, key: 'start' | 'end'): string | undefined {
  const time = asRecord(state.time)
  const value = numberField(time, key)
  return value ? new Date(value).toISOString() : undefined
}

function toolKindForMimoTool(toolName: string): 'tool_call' | 'command_execution' | 'file_change' {
  const normalized = toolName.trim().toLowerCase()
  if (['bash', 'shell', 'terminal', 'exec'].includes(normalized)) return 'command_execution'
  if (['write', 'edit', 'apply_patch', 'patch', 'create_plan'].includes(normalized)) return 'file_change'
  return 'tool_call'
}

function toolDisplayTitle(toolName: string, input: Record<string, unknown>): string {
  const named = stringField(input, 'name')
  if (toolName === 'skill' && named) return `Loading skill: ${named}`
  const command = stringField(input, 'command') || stringField(input, 'cmd')
  if (command) return command
  return toolName
}

function syntheticQuestionInputId(threadId: string, part: Record<string, unknown>): string {
  const sourceId = stringField(part, 'callID') || stringField(part, 'id') || stringField(part, 'messageID')
  return `synthetic_question_${shortHash(`${threadId}:${sourceId || stableJson(part)}`)}`
}

function questionToolQuestions(part: Record<string, unknown>): Array<Record<string, unknown>> {
  const questions = asRecord(asRecord(part.state).input).questions
  return Array.isArray(questions) ? mapMimoQuestions(questions) : []
}

function syntheticQuestionToTurnItem(
  threadId: string,
  turnId: string,
  createdAt: string,
  part: Record<string, unknown>
): Record<string, unknown> | null {
  const questions = questionToolQuestions(part)
  if (!questions.length) return null
  const inputId = syntheticQuestionInputId(threadId, part)
  const resolved = resolvedSyntheticQuestionInputs.get(inputId)
  if (resolved) {
    return {
      id: inputId,
      turnId,
      threadId,
      role: 'tool',
      status: resolved.status,
      createdAt: toolTime(asRecord(part.state), 'start') ?? createdAt,
      kind: 'user_input',
      inputId,
      prompt: 'Input requested',
      questions,
      ...(resolved.answers ? { answers: resolved.answers } : {})
    }
  }
  syntheticQuestionInputs.set(inputId, { threadId, questions })
  return {
    id: inputId,
    turnId,
    threadId,
    role: 'tool',
    status: 'pending',
    createdAt: toolTime(asRecord(part.state), 'start') ?? createdAt,
    kind: 'user_input',
    inputId,
    prompt: 'Input requested',
    questions
  }
}

function hasMatchingPendingQuestion(
  part: Record<string, unknown>,
  pendingQuestions: Record<string, unknown>[]
): boolean {
  const callId = stringField(part, 'callID')
  if (!callId) return false
  return pendingQuestions.some((question) => stringField(asRecord(question.tool), 'callID') === callId)
}

function syntheticQuestionEvent(
  seq: number,
  threadId: string,
  part: Record<string, unknown>,
  pendingQuestions: Record<string, unknown>[]
): Record<string, unknown> | null {
  if (hasMatchingPendingQuestion(part, pendingQuestions)) return null
  const questions = questionToolQuestions(part)
  if (!questions.length) return null
  const inputId = syntheticQuestionInputId(threadId, part)
  if (resolvedSyntheticQuestionInputs.has(inputId)) return null
  const fingerprint = stableJson({ questions })
  const key = partTypeKey(threadId, inputId)
  if (pendingQuestionFingerprintById.get(key) === fingerprint) return null
  pendingQuestionFingerprintById.set(key, fingerprint)
  syntheticQuestionInputs.set(inputId, { threadId, questions })
  return {
    seq,
    threadId,
    kind: 'user_input_requested',
    timestamp: new Date().toISOString(),
    inputId,
    itemId: inputId,
    prompt: 'Input requested',
    questions
  }
}

function syntheticQuestionFollowupPrompt(
  questions: Array<Record<string, unknown>>,
  rawAnswers: unknown[]
): string {
  const answersById = new Map<string, string>()
  for (const rawAnswer of rawAnswers) {
    const answer = asRecord(rawAnswer)
    const id = stringField(answer, 'id')
    if (!id) continue
    const label = stringField(answer, 'label')
    const value = stringField(answer, 'value')
    answersById.set(id, value && value !== label ? `${label}: ${value}` : (value || label))
  }
  const lines = [
    SYNTHETIC_QUESTION_FOLLOWUP_MARKER,
    CODE_MIMO_WORK_EXECUTION_GUARDRAILS,
    '请把下面的回答当作该 question 工具的结果继续执行原任务，不要再次询问同一组问题；如果信息仍不足，请用普通文本简短说明还缺什么。',
    ''
  ]
  for (const question of questions) {
    const id = stringField(question, 'id')
    const header = stringField(question, 'header') || id || 'Question'
    const prompt = stringField(question, 'question')
    const answer = answersById.get(id) || '（未回答）'
    lines.push(`- ${header}${prompt ? `：${prompt}` : ''}`)
    lines.push(`  回答：${answer}`)
  }
  return lines.join('\n')
}

function messageText(parts: unknown[]): string {
  return parts
    .map((part) => stringField(asRecord(part), 'text'))
    .filter((text) => text.trim().length > 0)
    .join('\n')
}

async function streamThreadEvents(
  req: IncomingMessage,
  res: ServerResponse,
  settings: AppSettingsV1,
  mimoBaseUrl: string,
  threadId: string
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const lastEventId = req.headers['last-event-id']
  const sinceSeq = numericSearchParam(url, 'since_seq') ??
    (typeof lastEventId === 'string' && /^\d+$/.test(lastEventId) ? Number(lastEventId) : 0)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })
  for (const event of replayEventsForThread(threadId, sinceSeq)) {
    writeSseEvent(res, event)
  }
  const controller = new AbortController()
  req.on('close', () => controller.abort())
  let snapshotPolling = false
  let turnTerminalEventSent = false
  let upstreamEndedUnexpectedly = false
  let upstreamFailureMessage = ''
  const pollSnapshot = async (): Promise<void> => {
    if (snapshotPolling || controller.signal.aborted || !pendingSnapshotSinceByThread.has(threadId)) return
    snapshotPolling = true
    try {
      const messages = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/message`, {
        headers: mimoHeaders()
      }).catch(() => [])
      const questions = await listPendingQuestionsForThread(mimoBaseUrl, threadId)
      await autoApprovePendingPermissionsForThread(settings, mimoBaseUrl, threadId)
      await recoverStalledRuntimeToolParts({
        settings,
        mimoBaseUrl,
        threadId,
        messages: Array.isArray(messages) ? messages : []
      })
      const events = mapMimoMessageSnapshotEvents(
        threadId,
        Array.isArray(messages) ? messages : [],
        pendingSnapshotSinceByThread.get(threadId) ?? 0,
        questions
      )
      events.push(...mapPendingQuestionEvents(threadId, questions))
      for (const event of events) {
        rememberReplayEvent(threadId, event)
        writeSseEvent(res, event)
      }
      if (events.some((event) => event.kind === 'turn_completed')) {
        turnTerminalEventSent = true
        pendingSnapshotSinceByThread.delete(threadId)
      }
    } finally {
      snapshotPolling = false
    }
  }
  const snapshotTimer = setInterval(() => {
    void pollSnapshot()
  }, 1_000)
  void pollSnapshot()
  try {
    const upstream = await fetch(`${mimoBaseUrl}/event`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal
    })
    if (!upstream.ok) {
      upstreamEndedUnexpectedly = true
      upstreamFailureMessage = `MiMo event stream failed with HTTP ${upstream.status}`
      return
    }
    if (!upstream.body) {
      upstreamEndedUnexpectedly = true
      upstreamFailureMessage = 'MiMo event stream ended without a response body'
      return
    }
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read()
      if (done) {
        upstreamEndedUnexpectedly = true
        upstreamFailureMessage = 'MiMo event stream ended before the turn completed'
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let split = buffer.indexOf('\n\n')
      while (split !== -1) {
        const block = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const data = parseSseData(block)
        if (data && await autoApprovePermissionEvent(settings, mimoBaseUrl, threadId, data)) {
          split = buffer.indexOf('\n\n')
          continue
        }
        const event = data ? mapMimoEvent(threadId, data) : null
        if (event) {
          rememberReplayEvent(threadId, event)
          writeSseEvent(res, event)
          if (event.kind === 'turn_completed') {
            turnTerminalEventSent = true
            pendingSnapshotSinceByThread.delete(threadId)
          }
        }
        split = buffer.indexOf('\n\n')
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return
    upstreamEndedUnexpectedly = true
    upstreamFailureMessage = error instanceof Error ? error.message : String(error)
  } finally {
    if (
      upstreamEndedUnexpectedly &&
      !controller.signal.aborted &&
      !turnTerminalEventSent &&
      pendingSnapshotSinceByThread.has(threadId)
    ) {
      await pollSnapshot().catch(() => undefined)
      if (!turnTerminalEventSent && pendingSnapshotSinceByThread.has(threadId) && !res.writableEnded) {
        const event = runtimeStreamFailedEvent(threadId, upstreamFailureMessage)
        rememberReplayEvent(threadId, event)
        writeSseEvent(res, event)
        pendingSnapshotSinceByThread.delete(threadId)
      }
    }
    clearInterval(snapshotTimer)
  }
}

function writeSseEvent(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(`id: ${event.seq}\n`)
  res.write(`event: ${event.kind}\n`)
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function replayEventsForThread(threadId: string, sinceSeq: number): Record<string, unknown>[] {
  return (replayEvents.get(threadId) ?? [])
    .filter((event) => (numberField(event, 'seq') ?? 0) > sinceSeq)
}

function rememberReplayEvent(threadId: string, event: Record<string, unknown>): void {
  const events = replayEvents.get(threadId) ?? []
  events.push(event)
  if (events.length > EVENT_REPLAY_LIMIT) {
    events.splice(0, events.length - EVENT_REPLAY_LIMIT)
  }
  replayEvents.set(threadId, events)
}

function parseSseData(block: string): unknown {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

function nextSeq(threadId: string): number {
  const seq = (latestSeq.get(threadId) ?? 0) + 1
  latestSeq.set(threadId, seq)
  return seq
}

function runtimeStreamFailedEvent(threadId: string, message?: string): Record<string, unknown> {
  const detail = message?.trim()
  return {
    seq: nextSeq(threadId),
    threadId,
    kind: 'turn_failed',
    timestamp: new Date().toISOString(),
    code: 'mimo_event_stream_failed',
    severity: 'error',
    message: detail
      ? `MIMO Work 运行时事件流已中断，当前回复没有完成。请检查模型供应商或重试。详情：${redactSecretText(detail)}`
      : 'MIMO Work 运行时事件流已中断，当前回复没有完成。请检查模型供应商或重试。'
  }
}

function assistantMessageFailedEvent(threadId: string, message: string): Record<string, unknown> {
  return {
    seq: nextSeq(threadId),
    threadId,
    kind: 'turn_failed',
    timestamp: new Date().toISOString(),
    code: 'mimo_assistant_error',
    severity: 'error',
    message: redactSecretText(message)
  }
}

function mapMimoEvent(threadId: string, value: unknown): Record<string, unknown> | null {
  const event = asRecord(value)
  const properties = eventProperties(event)
  if (eventSessionId(event, properties) !== threadId) return null
  const seq = nextSeq(threadId)
  const type = stringField(event, 'type') || 'mimo.event'
  if (type === 'message.updated') {
    rememberMessageRole(threadId, asRecord(properties.info))
  }
  if (type === 'message.part.updated') {
    const part = asRecord(properties.part)
    rememberPartMessageRole(threadId, part)
    if (partBelongsToNonAssistantMessage(threadId, part)) return null
    rememberPartType(threadId, part)
    const partType = stringField(part, 'type')
    if (partType === 'tool') return toolPartEvent(seq, threadId, part)
    if (partType !== 'text' && partType !== 'reasoning') return null
    const rawText = stringField(part, 'text')
    const text = stripMimoWorkInternalText(rawText)
    if (!text) return null
    const partID = stringField(part, 'id')
    const key = partTypeKey(threadId, partID)
    partRawTextById.set(key, rawText)
    const previous = partTextById.get(key) ?? ''
    if (previous === text) return null
    const delta = text.startsWith(previous) ? text.slice(previous.length) : text
    partTextById.set(key, text)
    return assistantDeltaEvent(seq, threadId, partID, stringField(part, 'messageID'), partType, delta)
  }
  if (type === 'message.part.delta') {
    const delta = stringField(properties, 'delta')
    if (!delta || stringField(properties, 'field') !== 'text') return null
    const partID = stringField(properties, 'partID')
    if (partDeltaBelongsToNonAssistantMessage(threadId, properties)) return null
    const partType = partTypeById.get(partTypeKey(threadId, partID)) || 'text'
    const key = partTypeKey(threadId, partID)
    const rawText = `${partRawTextById.get(key) ?? ''}${delta}`
    partRawTextById.set(key, rawText)
    const text = stripMimoWorkInternalText(rawText)
    const previous = partTextById.get(key) ?? ''
    if (previous === text) return null
    const visibleDelta = text.startsWith(previous) ? text.slice(previous.length) : text
    partTextById.set(key, text)
    return assistantDeltaEvent(seq, threadId, partID, stringField(properties, 'messageID'), partType, visibleDelta)
  }
  if (type === 'session.idle') return null
  if (type === 'permission.asked') {
    return {
      seq,
      threadId,
      kind: 'approval_requested',
      timestamp: new Date().toISOString(),
      approvalId: stringField(properties, 'id') || `approval_${seq}`,
      toolName: stringField(asRecord(properties.tool), 'callID') || stringField(properties, 'permission') || undefined,
      summary: permissionSummary(properties),
      approvalPolicy: 'suggest'
    }
  }
  if (type === 'permission.replied') {
    const reply = stringField(properties, 'reply')
    return {
      seq,
      threadId,
      kind: 'approval_resolved',
      timestamp: new Date().toISOString(),
      approvalId: stringField(properties, 'requestID') || `approval_${seq}`,
      status: reply === 'reject' ? 'denied' : 'allowed'
    }
  }
  if (type === 'question.asked') {
    return pendingQuestionEvent(seq, threadId, properties)
  }
  if (type === 'question.replied' || type === 'question.rejected') {
    const inputId = stringField(properties, 'requestID') || `input_${seq}`
    pendingQuestionFingerprintById.delete(partTypeKey(threadId, inputId))
    return {
      seq,
      threadId,
      kind: 'user_input_resolved',
      timestamp: new Date().toISOString(),
      inputId,
      status: type === 'question.rejected' ? 'cancelled' : 'submitted'
    }
  }
  if (type === 'todo.updated') {
    const todos = mapMimoTodos(threadId, Array.isArray(properties.todos) ? properties.todos : [])
    localTodos.set(threadId, todos)
    return {
      seq,
      threadId,
      kind: 'todos_updated',
      timestamp: new Date().toISOString(),
      todos
    }
  }
  if (type === 'session.goal') {
    const goalPayload = asRecord(properties.goal)
    const goal = stringField(goalPayload, 'condition')
      ? upsertLocalGoal(threadId, { objective: stringField(goalPayload, 'condition'), status: 'active' })
      : null
    if (!goal) localGoals.delete(threadId)
    return {
      seq,
      threadId,
      kind: goal ? 'goal_updated' : 'goal_cleared',
      timestamp: new Date().toISOString(),
      goal
    }
  }
  return {
    seq,
    threadId,
    kind: 'runtime_status',
    timestamp: new Date().toISOString(),
    message: type,
    status: mimoStatusText(properties) || 'running'
  }
}

function eventProperties(event: Record<string, unknown>): Record<string, unknown> {
  const properties = asRecord(event.properties)
  return Object.keys(properties).length ? properties : event
}

function eventSessionId(event: Record<string, unknown>, properties: Record<string, unknown>): string {
  return stringField(properties, 'sessionID')
    || stringField(event, 'sessionID')
    || stringField(asRecord(properties.part), 'sessionID')
    || stringField(asRecord(event.part), 'sessionID')
}

async function listPendingQuestionsForThread(
  mimoBaseUrl: string,
  threadId: string
): Promise<Record<string, unknown>[]> {
  const questions = await mimoJson(mimoBaseUrl, '/question').catch(() => [])
  if (!Array.isArray(questions)) return []
  return questions
    .map((question) => asRecord(question))
    .filter((question) => stringField(question, 'sessionID') === threadId)
}

async function listPendingPermissionsForThread(
  mimoBaseUrl: string,
  threadId: string
): Promise<Record<string, unknown>[]> {
  const permissions = await mimoJson(mimoBaseUrl, '/permission').catch(() => [])
  if (!Array.isArray(permissions)) return []
  return permissions
    .map((permission) => asRecord(permission))
    .filter((permission) => stringField(permission, 'sessionID') === threadId)
}

function shouldAutoApproveMimoPermission(settings: AppSettingsV1): boolean {
  const runtime = getKunRuntimeSettings(settings)
  return runtime.approvalPolicy === 'auto' && runtime.sandboxMode === 'danger-full-access'
}

async function replyToMimoPermission(
  mimoBaseUrl: string,
  permissionId: string,
  decision: 'allow' | 'deny',
  message?: string
): Promise<void> {
  await mimoJson(mimoBaseUrl, `/permission/${encodeURIComponent(permissionId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({
      reply: decision === 'allow' ? 'once' : 'reject',
      message
    }),
    headers: mimoHeaders()
  })
}

async function autoApprovePermissionRequest(
  settings: AppSettingsV1,
  mimoBaseUrl: string,
  permission: Record<string, unknown>
): Promise<boolean> {
  if (!shouldAutoApproveMimoPermission(settings)) return false
  const permissionId = stringField(permission, 'id') || stringField(permission, 'requestID')
  if (!permissionId) return false
  if (autoApprovedPermissionIds.has(permissionId)) return true
  autoApprovedPermissionIds.add(permissionId)
  await replyToMimoPermission(mimoBaseUrl, permissionId, 'allow').catch(() => {
    autoApprovedPermissionIds.delete(permissionId)
  })
  return autoApprovedPermissionIds.has(permissionId)
}

async function autoApprovePermissionEvent(
  settings: AppSettingsV1,
  mimoBaseUrl: string,
  threadId: string,
  value: unknown
): Promise<boolean> {
  const event = asRecord(value)
  if (stringField(event, 'type') !== 'permission.asked') return false
  const properties = eventProperties(event)
  if (eventSessionId(event, properties) !== threadId) return false
  return autoApprovePermissionRequest(settings, mimoBaseUrl, properties)
}

async function autoApprovePendingPermissionsForThread(
  settings: AppSettingsV1,
  mimoBaseUrl: string,
  threadId: string
): Promise<void> {
  const permissions = await listPendingPermissionsForThread(mimoBaseUrl, threadId)
  await Promise.all(permissions.map((permission) => autoApprovePermissionRequest(settings, mimoBaseUrl, permission)))
}

function mapPendingQuestionEvents(
  threadId: string,
  questions: Record<string, unknown>[]
): Record<string, unknown>[] {
  return questions
    .map((question) => pendingQuestionEvent(nextSeq(threadId), threadId, question))
    .filter((event): event is Record<string, unknown> => event !== null)
}

function pendingQuestionEvent(
  seq: number,
  threadId: string,
  question: Record<string, unknown>
): Record<string, unknown> | null {
  const inputId = stringField(question, 'id')
  if (!inputId) return null
  const mappedQuestions = mapMimoQuestions(Array.isArray(question.questions) ? question.questions : [])
  const key = partTypeKey(threadId, inputId)
  const fingerprint = stableJson({ questions: mappedQuestions })
  if (pendingQuestionFingerprintById.get(key) === fingerprint) return null
  pendingQuestionFingerprintById.set(key, fingerprint)
  return {
    seq,
    threadId,
    kind: 'user_input_requested',
    timestamp: new Date().toISOString(),
    inputId,
    itemId: inputId,
    prompt: 'Input requested',
    questions: mappedQuestions
  }
}

function appendPendingQuestionItemsToTurns(
  threadId: string,
  turns: Record<string, unknown>[],
  questions: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (!questions.length) return turns
  const nextTurns: Record<string, unknown>[] = turns.map((turn) => ({
    ...turn,
    items: Array.isArray(turn.items) ? [...turn.items] : []
  }))
  const now = new Date().toISOString()
  if (!nextTurns.length) {
    nextTurns.push({
      id: `mimo_question_${threadId}`,
      threadId,
      status: 'running',
      prompt: '',
      createdAt: now,
      items: []
    })
  }
  const targetTurn = nextTurns[nextTurns.length - 1] as Record<string, unknown>
  const items = Array.isArray(targetTurn.items) ? targetTurn.items as unknown[] : []
  const existing = new Set(items.map((item) => {
    const record = asRecord(item)
    return stringField(record, 'inputId') || stringField(record, 'id')
  }))
  for (const question of questions) {
    const item = pendingQuestionToTurnItem(threadId, stringField(targetTurn, 'id') || `mimo_question_${threadId}`, now, question)
    if (!item) continue
    const itemKey = stringField(item, 'inputId') || stringField(item, 'id')
    if (existing.has(itemKey)) continue
    existing.add(itemKey)
    items.push(item)
  }
  targetTurn.items = items
  return nextTurns
}

function pendingQuestionToTurnItem(
  threadId: string,
  turnId: string,
  createdAt: string,
  question: Record<string, unknown>
): Record<string, unknown> | null {
  const inputId = stringField(question, 'id')
  if (!inputId) return null
  return {
    id: inputId,
    turnId,
    threadId,
    role: 'tool',
    status: 'pending',
    createdAt,
    kind: 'user_input',
    inputId,
    prompt: 'Input requested',
    questions: mapMimoQuestions(Array.isArray(question.questions) ? question.questions : [])
  }
}

function mapMimoMessageSnapshotEvents(
  threadId: string,
  messages: unknown[],
  sinceMs: number,
  pendingQuestions: Record<string, unknown>[] = []
): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = []
  for (const message of messages) {
    const record = asRecord(message)
    const info = asRecord(record.info)
    if (stringField(info, 'role') !== 'assistant') continue
    const messageId = stringField(info, 'id')
    if (!messageId) continue
    const createdMs = messageCreatedMs(info)
    if (createdMs && sinceMs && createdMs < sinceMs) continue
    const parts = Array.isArray(record.parts) ? record.parts : []
    for (const rawPart of parts) {
      const part = asRecord(rawPart)
      rememberPartType(threadId, part)
      const partType = stringField(part, 'type')
      if (partType === 'tool') {
        const event = toolPartEvent(nextSeq(threadId), threadId, part, {
          pendingQuestions,
          synthesizeQuestion: true
        })
        if (event) events.push(event)
        continue
      }
      if (partType !== 'text' && partType !== 'reasoning') continue
      const rawText = stringField(part, 'text')
      const text = stripMimoWorkInternalText(rawText)
      if (!text) continue
      const partID = stringField(part, 'id')
      const key = partTypeKey(threadId, partID)
      partRawTextById.set(key, rawText)
      const previous = partTextById.get(key) ?? ''
      if (previous !== text) {
        const delta = text.startsWith(previous) ? text.slice(previous.length) : text
        partTextById.set(key, text)
        const event = assistantDeltaEvent(nextSeq(threadId), threadId, partID, messageId, partType, delta)
        if (event) events.push(event)
      }
    }
    const errorMessage = assistantInfoErrorMessage(info)
    const failedKey = `${threadId}:${messageId}:failed`
    if (errorMessage) {
      if (!failedSnapshotMessages.has(failedKey)) {
        failedSnapshotMessages.add(failedKey)
        events.push(assistantMessageFailedEvent(threadId, errorMessage))
      }
      continue
    }
    const completedKey = `${threadId}:${messageId}`
    if (
      !completedSnapshotMessages.has(completedKey) &&
      assistantMessageCompletesVisibleTurn(info, parts)
    ) {
      completedSnapshotMessages.add(completedKey)
      events.push({
        seq: nextSeq(threadId),
        threadId,
        kind: 'turn_completed',
        timestamp: new Date().toISOString()
      })
    }
  }
  return events
}

function messageCreatedMs(info: Record<string, unknown>): number {
  const time = asRecord(info.time)
  return numberField(time, 'created') ?? numberField(info, 'created') ?? 0
}

function assistantMessageCompletesVisibleTurn(info: Record<string, unknown>, parts: unknown[]): boolean {
  const finish = stringField(info, 'finish')
  if (finish === 'tool-calls') return false
  if (!assistantMessageHasVisibleContent(parts)) return false
  const time = asRecord(info.time)
  if (numberField(time, 'completed')) return true
  if (finish) return true
  return parts.some((part) => stringField(asRecord(part), 'type') === 'step-finish')
}

function assistantMessageHasVisibleContent(parts: unknown[]): boolean {
  return parts.some((part) => {
    const record = asRecord(part)
    const partType = stringField(record, 'type')
    if (partType !== 'text' && partType !== 'reasoning') return false
    return stripMimoWorkInternalText(stringField(record, 'text')).trim().length > 0
  })
}

function assistantInfoErrorMessage(info: Record<string, unknown>): string {
  const error = asRecord(info.error)
  if (!Object.keys(error).length) return ''
  const data = asRecord(error.data)
  const pieces = [
    stringField(error, 'message'),
    stringField(error, 'name'),
    stringField(data, 'message'),
    stringField(data, 'param')
  ].filter(Boolean)
  const statusCode = numberField(data, 'statusCode')
  if (statusCode) pieces.push(`HTTP ${statusCode}`)
  const uniquePieces = [...new Set(pieces)]
  const message = uniquePieces.length
    ? uniquePieces.join(': ')
    : 'MiMo runtime returned an assistant error without a message.'
  return redactSecretText(message)
}

function partTypeKey(threadId: string, partId: string): string {
  return `${threadId}:${partId}`
}

function toolPartEvent(
  seq: number,
  threadId: string,
  part: Record<string, unknown>,
  options: {
    pendingQuestions?: Record<string, unknown>[]
    synthesizeQuestion?: boolean
  } = {}
): Record<string, unknown> | null {
  if (isPendingQuestionToolPart(part)) {
    return options.synthesizeQuestion
      ? syntheticQuestionEvent(seq, threadId, part, options.pendingQuestions ?? [])
      : null
  }
  const item = toolPartToTurnItem(threadId, stringField(part, 'messageID') || `turn_${seq}`, new Date().toISOString(), part)
  if (!item) return null
  const key = partTypeKey(threadId, stringField(part, 'id') || stringField(part, 'callID') || `tool_${seq}`)
  const fingerprint = stableJson({
    status: item.status,
    output: item.output,
    arguments: item.arguments,
    summary: item.summary
  })
  if (partFingerprintById.get(key) === fingerprint) return null
  partFingerprintById.set(key, fingerprint)
  const status = stringField(item, 'status')
  return {
    seq,
    threadId,
    kind: status === 'completed' || status === 'failed' || status === 'aborted'
      ? 'tool_call_finished'
      : 'tool_call_started',
    timestamp: new Date().toISOString(),
    itemId: stringField(item, 'id') || undefined,
    item
  }
}

function isPendingQuestionToolPart(part: Record<string, unknown>): boolean {
  const toolName = stringField(part, 'tool').trim().toLowerCase()
  if (toolName !== 'question') return false
  const status = stringField(asRecord(part.state), 'status').trim().toLowerCase()
  return status !== 'completed' && status !== 'error'
}

function isStalledWriteToolPart(part: Record<string, unknown>): boolean {
  const toolName = stringField(part, 'tool').trim().toLowerCase()
  if (toolName !== 'write') return false
  const status = stringField(asRecord(part.state), 'status').trim().toLowerCase()
  return status === 'pending' || status === 'running'
}

function isRecoverableStalledToolPart(part: Record<string, unknown>): boolean {
  if (isStalledWriteToolPart(part)) return true
  const toolName = stringField(part, 'tool').trim().toLowerCase()
  if (!['bash', 'shell', 'terminal', 'exec'].includes(toolName)) return false
  const state = asRecord(part.state)
  if (stringField(state, 'status').trim().toLowerCase() !== 'running') return false
  const startedAt = numberField(asRecord(state.time), 'start')
  const command = stringField(asRecord(state.input), 'command')
  if (!startedAt) {
    return !command.trim() ||
      hasUnsupportedBashWorkdir(asRecord(state.input)) ||
      looksLikeShortShellCommand(command) ||
      looksLikeDependencyInstallCommand(command)
  }
  if (Date.now() - startedAt < STALLED_SHORT_COMMAND_MS) return false
  if (!command.trim()) return true
  if (hasUnsupportedBashWorkdir(asRecord(state.input))) return true
  if (looksLikeShortShellCommand(command)) return true
  return Date.now() - startedAt >= STALLED_INSTALL_COMMAND_MS && looksLikeDependencyInstallCommand(command)
}

function isRecoverableFailedToolPart(part: Record<string, unknown>): boolean {
  const toolName = stringField(part, 'tool').trim().toLowerCase()
  if (!['bash', 'shell', 'terminal', 'exec', 'write'].includes(toolName)) return false
  const state = asRecord(part.state)
  const status = stringField(state, 'status').trim().toLowerCase()
  if (!['error', 'failed'].includes(status)) return false
  const endedAt = numberField(asRecord(state.time), 'end')
  return !endedAt || Date.now() - endedAt >= FAILED_TOOL_RECOVERY_GRACE_MS
}

function looksLikeShortShellCommand(command: string): boolean {
  const normalized = command.trim()
  if (!normalized || normalized.length > 500) return false
  return /^(mkdir|pwd|ls|test|which|command\s+-v|python3?\s+-c|node\s+-e|cat\s+)/.test(normalized)
}

function looksLikeDependencyInstallCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase()
  if (!normalized) return false
  return /(^|[;&|]\s*)((python3?|uv)\s+-m\s+pip|pip3?|npm|pnpm|yarn|bun|brew)\s+(install|add|i)\b/.test(normalized)
}

function hasUnsupportedBashWorkdir(input: Record<string, unknown>): boolean {
  return Boolean(stringField(input, 'workdir') || stringField(input, 'cwd'))
}

function hasAssistantProgressAfter(messages: unknown[], messageIndex: number, partIndex: number): boolean {
  for (let outer = messageIndex; outer < messages.length; outer += 1) {
    const message = asRecord(messages[outer])
    if (asRecord(message.info).role !== 'assistant') continue
    const parts = Array.isArray(message.parts) ? message.parts : []
    const start = outer === messageIndex ? partIndex + 1 : 0
    for (let inner = start; inner < parts.length; inner += 1) {
      const part = asRecord(parts[inner])
      const type = stringField(part, 'type')
      if ((type === 'text' || type === 'reasoning') && stringField(part, 'text').trim()) return true
      if (type === 'tool') {
        const status = stringField(asRecord(part.state), 'status').trim().toLowerCase()
        if (status === 'running' || status === 'pending' || status === 'completed') return true
      }
    }
  }
  return false
}

async function recoverStalledRuntimeToolParts({
  settings,
  mimoBaseUrl,
  threadId,
  messages
}: {
  settings: AppSettingsV1
  mimoBaseUrl: string
  threadId: string
  messages: unknown[]
}): Promise<void> {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    const parts = Array.isArray(asRecord(message).parts) ? asRecord(message).parts as unknown[] : []
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const rawPart = parts[partIndex]
      const part = asRecord(rawPart)
      const recoveryKind = isRecoverableStalledToolPart(part)
        ? 'stalled'
        : (isRecoverableFailedToolPart(part) && !hasAssistantProgressAfter(messages, messageIndex, partIndex) ? 'failed' : '')
      if (!recoveryKind) continue
      const recoveryKey = partTypeKey(threadId, `${recoveryKind}:${stringField(part, 'callID') || stringField(part, 'id') || stableJson(part)}`)
      if (recoveredStalledRuntimeTools.has(recoveryKey)) continue
      recoveredStalledRuntimeTools.add(recoveryKey)
      const mimo = effectiveMimoCredentials(settings)
      pendingSnapshotSinceByThread.set(threadId, Date.now() - 5_000)
      await abortThreadRun(mimoBaseUrl, settings, threadId)
      const recoveryPrompt = recoveryKind === 'failed'
        ? failedToolRecoveryPrompt(part)
        : stalledWriteRecoveryPrompt()
      await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/prompt_async`, {
        method: 'POST',
        body: JSON.stringify({
          parts: buildPromptParts({}, withWorkspaceRuntimePrompt(settings, threadWorkspace(settings, threadId), recoveryPrompt)),
          agent: 'build',
          model: { providerID: 'xiaomi', modelID: mimo.model },
          source: 'user',
          tools: MIMO_WORK_REQUEST_TOOL_OVERRIDES
        }),
        headers: mimoHeaders()
      }).catch(() => undefined)
    }
  }
}

function stalledWriteRecoveryPrompt(): string {
  return [
    'MIMO Work detected that a Core runtime tool stalled and recovered the turn.',
    CODE_MIMO_WORK_EXECUTION_GUARDRAILS,
    '请继续完成原任务，但不要再调用 write 工具。',
    '不要再运行 pip/npm/brew 等依赖安装命令；优先使用系统已有能力，必要时用 Python 标准库 zipfile 生成最小合法 DOCX。',
    'bash 工具不要传 workdir/cwd 字段；请把 cd 命令写在 command 字符串里，或使用绝对路径。',
    '如果需要创建脚本、数据、图表或 .docx 文件，必须改用 bash/python/node，例如通过 bash heredoc 或 python 脚本一次性写入文件。',
    '继续原任务，不要重新询问已经确认过的信息。'
  ].join('\n')
}

function failedToolRecoveryPrompt(part: Record<string, unknown>): string {
  const toolName = stringField(part, 'tool') || 'tool'
  const input = asRecord(asRecord(part.state).input)
  const command = stringField(input, 'command') || stringField(input, 'cmd')
  return [
    `MIMO Work detected that the ${toolName} tool failed and the turn ended without delivering the requested artifact.`,
    command ? `Failed command: ${command}` : '',
    CODE_MIMO_WORK_EXECUTION_GUARDRAILS,
    '请立即继续完成原任务，不要重新询问已经确认过的信息。',
    '如果原任务要求生成 .docx，请跳过需要交互或容易卡住的文档 skill 流程，直接使用 bash/python/node 创建文件。',
    '不要再运行 pip/npm/brew 等依赖安装命令；优先使用已有依赖，必要时用 Python 标准库 zipfile 生成最小合法 DOCX 包。',
    'bash 工具不要传 workdir/cwd 字段；请把 cd 命令写在 command 字符串里，或使用绝对路径。',
    '优先使用 python3 + python-docx；如果依赖不可用，请用 Python zipfile 生成最小合法 DOCX 包。',
    '必须把最终文件保存到本轮工作区，并在回复里给出生成文件的相对路径和简短校验结果。'
  ].filter(Boolean).join('\n')
}

function rememberPartType(threadId: string, part: Record<string, unknown>): void {
  const partId = stringField(part, 'id')
  const type = stringField(part, 'type')
  if (!partId || !type) return
  partTypeById.set(partTypeKey(threadId, partId), type)
}

function rememberMessageRole(threadId: string, info: Record<string, unknown>): void {
  const messageId = stringField(info, 'id')
  const role = stringField(info, 'role')
  if (!messageId || !role) return
  messageRoleById.set(partTypeKey(threadId, messageId), role)
}

function rememberPartMessageRole(threadId: string, part: Record<string, unknown>): void {
  const partId = stringField(part, 'id')
  const messageId = stringField(part, 'messageID')
  if (!partId || !messageId) return
  const role = messageRoleById.get(partTypeKey(threadId, messageId))
  if (role) partMessageRoleById.set(partTypeKey(threadId, partId), role)
}

function partBelongsToNonAssistantMessage(threadId: string, part: Record<string, unknown>): boolean {
  const messageId = stringField(part, 'messageID')
  const partId = stringField(part, 'id')
  const role = messageId
    ? messageRoleById.get(partTypeKey(threadId, messageId))
    : partMessageRoleById.get(partTypeKey(threadId, partId))
  return Boolean(role && role !== 'assistant')
}

function partDeltaBelongsToNonAssistantMessage(threadId: string, properties: Record<string, unknown>): boolean {
  const messageId = stringField(properties, 'messageID')
  const partId = stringField(properties, 'partID')
  const role = messageId
    ? messageRoleById.get(partTypeKey(threadId, messageId))
    : partMessageRoleById.get(partTypeKey(threadId, partId))
  return Boolean(role && role !== 'assistant')
}

function assistantDeltaEvent(
  seq: number,
  threadId: string,
  partID: string,
  messageID: string,
  partType: string,
  delta: string
): Record<string, unknown> | null {
  if (!delta) return null
  const reasoning = partType === 'reasoning'
  return {
    seq,
    threadId,
    kind: reasoning ? 'assistant_reasoning_delta' : 'assistant_text_delta',
    timestamp: new Date().toISOString(),
    itemId: partID || `assistant_${seq}`,
    messageId: messageID || undefined,
    item: {
      id: partID || `assistant_${seq}`,
      threadId,
      role: 'assistant',
      status: 'running',
      kind: reasoning ? 'assistant_reasoning' : 'assistant_text',
      text: delta
    }
  }
}

function mimoStatusText(properties: Record<string, unknown>): string {
  const direct = stringField(properties, 'status')
  if (direct) return direct
  const status = asRecord(properties.status)
  return stringField(status, 'type') || stringField(status, 'message')
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      return Object.keys(item as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((out, key) => {
          out[key] = (item as Record<string, unknown>)[key]
          return out
        }, {})
    })
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asId(value: unknown): string {
  return stringField(asRecord(value), 'id') || 'unknown'
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  return stringArray(record[key]) ?? []
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
  return items.length ? items : undefined
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function runtimeInfo(settings: AppSettingsV1): Record<string, unknown> {
  const runtime = getKunRuntimeSettings(settings)
  const mimo = effectiveMimoCredentials(settings)
  return {
    host: '127.0.0.1',
    port: runtime.port,
    dataDir: runtime.dataDir,
    model: mimo.model,
    endpointFormat: 'chat_completions',
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    tokenEconomyMode: false,
    insecure: false,
    startedAt: adapterStartedAt,
    pid: process.pid,
    capabilities: runtimeCapabilities(mimo.model)
  }
}

function runtimeCapabilities(model: string): Record<string, unknown> {
  const available = { status: 'available', enabled: true, available: true }
  const disabled = { status: 'disabled', enabled: false, available: false }
  const unavailable = { status: 'unavailable', enabled: false, available: false }
  return {
    contractVersion: 1,
    model: {
      id: model,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text'],
      reasoning: {
        supportedEfforts: ['auto', 'off', 'low', 'medium', 'high', 'max'],
        defaultEffort: 'auto',
        requestProtocol: 'mimo-chat-completions'
      }
    },
    cli: { serve: available, run: unavailable, chat: unavailable, exec: unavailable },
    mcp: {
      ...disabled,
      configuredServers: 0,
      connectedServers: 0,
      toolCount: 0,
      search: { enabled: false, mode: 'auto', active: false, indexedToolCount: 0, advertisedToolCount: 0 }
    },
    web: { ...disabled, fetch: disabled, search: disabled },
    skills: { ...available, configuredRoots: 0, discoveredSkills: 0 },
    subagents: { ...available, maxParallel: 0, maxChildRuns: 0, defaultToolPolicy: 'inherit', profiles: [] },
    attachments: {
      ...available,
      maxImageBytes: 5 * 1024 * 1024,
      maxImageDimension: 4096,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      textFallbackMaxBase64Bytes: 512 * 1024,
      textFallbackMaxImageDimension: 1280,
      textFallbackPreferredMimeType: 'image/webp'
    },
    memory: { ...available, scopes: ['user', 'workspace', 'project'], maxInjectedRecords: 8 },
    imageGen: disabled,
    speechGen: disabled,
    musicGen: disabled,
    videoGen: disabled
  }
}

function emptyUsageResponse(url: URL): Record<string, unknown> {
  const groupBy = url.searchParams.get('group_by') || 'thread'
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const timezone = url.searchParams.get('timezone') || 'UTC'
  const totals = { ...zeroUsageCounters(), days: 0, active_days: 0 }
  if (groupBy === 'day') {
    return { group_by: 'day', from, to, timezone, buckets: [], totals }
  }
  if (groupBy === 'model') {
    return { group_by: 'model', from, to, timezone, buckets: [], days: [], totals }
  }
  return { group_by: groupBy, from, to, timezone, buckets: [], totals }
}

async function usageResponse(mimoBaseUrl: string, url: URL, settings: AppSettingsV1): Promise<Record<string, unknown>> {
  const groupBy = url.searchParams.get('group_by') || 'thread'
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const timezone = url.searchParams.get('timezone') || 'UTC'
  const threadFilter = url.searchParams.get('thread_id')?.trim() || ''
  try {
    const rawSessions = threadFilter
      ? [{ id: threadFilter, title: threadFilter }]
      : await mimoJson(mimoBaseUrl, '/session')
    const sessions = Array.isArray(rawSessions) ? rawSessions.map(asRecord) : []
    const threadBuckets = new Map<string, Record<string, unknown>>()
    const dayBuckets = new Map<string, Record<string, unknown>>()
    const modelBuckets = new Map<string, Record<string, unknown>>()
    const mimo = effectiveMimoCredentials(settings)

    for (const session of sessions) {
      const threadId = asId(session)
      if (threadId === 'unknown') continue
      const messages = await mimoJson(mimoBaseUrl, `/session/${encodeURIComponent(threadId)}/message`, {
        headers: mimoHeaders()
      }).catch(() => [])
      if (!Array.isArray(messages)) continue
      const threadBucket = getUsageBucket(threadBuckets, threadId, {
        thread_id: threadId,
        key: threadId,
        id: threadId,
        label: stringField(session, 'title') || threadId
      })
      for (const message of messages) {
        const info = asRecord(asRecord(message).info)
        if (info.role !== 'assistant') continue
        const created = numberField(asRecord(info.time), 'completed') ?? numberField(asRecord(info.time), 'created') ?? Date.now()
        const date = dateInTimezone(new Date(created), timezone)
        if (!dateInRange(date, from, to)) continue
        const model = stringField(info, 'modelID') || mimo.model
        addMessageUsage(threadBucket, info, threadId)
        addMessageUsage(getUsageBucket(dayBuckets, date, { date }), info, threadId)
        addMessageUsage(getUsageBucket(modelBuckets, model, { model }), info, threadId)
      }
    }

    if (groupBy === 'day') {
      const buckets = fillUsageDays(from, to, dayBuckets).map(finalizeUsageBucket)
      return {
        group_by: 'day',
        from,
        to,
        timezone,
        buckets,
        totals: usageTotals(buckets, { days: buckets.length, active_days: buckets.filter(usageBucketHasActivity).length })
      }
    }

    if (groupBy === 'model') {
      const days = fillUsageDays(from, to, dayBuckets).map(finalizeUsageBucket)
      const buckets = [...modelBuckets.values()].map(finalizeUsageBucket)
      return {
        group_by: 'model',
        from,
        to,
        timezone,
        buckets,
        days,
        totals: usageTotals(days, { days: days.length, active_days: days.filter(usageBucketHasActivity).length })
      }
    }

    const buckets = [...threadBuckets.values()]
      .map(finalizeUsageBucket)
      .filter((bucket) => !threadFilter || bucket.thread_id === threadFilter)
    return {
      group_by: groupBy,
      from,
      to,
      timezone,
      buckets,
      totals: usageTotals(buckets)
    }
  } catch {
    return emptyUsageResponse(url)
  }
}

function zeroUsageCounters(): Record<string, number> {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    cached_tokens: 0,
    cache_miss_tokens: 0,
    cost_usd: 0,
    cost_cny: 0,
    token_economy_savings_tokens: 0,
    turns: 0,
    thread_count: 0,
    cache_hit_rate: 0
  }
}

function getUsageBucket(
  buckets: Map<string, Record<string, unknown>>,
  key: string,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const existing = buckets.get(key)
  if (existing) return existing
  const bucket = {
    ...zeroUsageCounters(),
    ...fields,
    __threadIds: new Set<string>()
  }
  buckets.set(key, bucket)
  return bucket
}

function addMessageUsage(bucket: Record<string, unknown>, info: Record<string, unknown>, threadId: string): void {
  const tokens = asRecord(info.tokens)
  const cache = asRecord(tokens.cache)
  const input = numberField(tokens, 'input') ?? 0
  const output = numberField(tokens, 'output') ?? 0
  const reasoning = numberField(tokens, 'reasoning') ?? 0
  const cacheRead = numberField(cache, 'read') ?? 0
  const cacheWrite = numberField(cache, 'write') ?? 0
  const cached = cacheRead + cacheWrite
  const inputWithCache = input + cached

  addUsageCounter(bucket, 'input_tokens', inputWithCache)
  addUsageCounter(bucket, 'output_tokens', output)
  addUsageCounter(bucket, 'reasoning_tokens', reasoning)
  addUsageCounter(bucket, 'cached_tokens', cached)
  addUsageCounter(bucket, 'cache_miss_tokens', input)
  addUsageCounter(bucket, 'total_tokens', numberField(tokens, 'total') ?? inputWithCache + output + reasoning)
  addUsageCounter(bucket, 'cost_usd', numberField(info, 'cost') ?? 0)
  addUsageCounter(bucket, 'turns', 1)

  const threadIds = bucket.__threadIds instanceof Set ? bucket.__threadIds as Set<string> : new Set<string>()
  threadIds.add(threadId)
  bucket.__threadIds = threadIds
  bucket.thread_count = threadIds.size
  bucket.last_turn_cache_hit_rate = inputWithCache > 0 ? cached / inputWithCache : 0
}

function addUsageCounter(bucket: Record<string, unknown>, key: string, value: number): void {
  bucket[key] = numberValue(bucket[key]) + (Number.isFinite(value) ? value : 0)
}

function finalizeUsageBucket(bucket: Record<string, unknown>): Record<string, unknown> {
  const result = { ...bucket }
  delete result.__threadIds
  const input = numberValue(result.input_tokens)
  const cached = numberValue(result.cached_tokens)
  result.cache_hit_rate = input > 0 ? cached / input : null
  if (!numberValue(result.total_tokens)) {
    result.total_tokens = input + numberValue(result.output_tokens) + numberValue(result.reasoning_tokens)
  }
  return result
}

function usageTotals(buckets: Array<Record<string, unknown>>, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const totals: Record<string, unknown> = { ...zeroUsageCounters(), ...fields }
  const threadIds = new Set<string>()
  for (const bucket of buckets) {
    for (const key of Object.keys(zeroUsageCounters())) {
      if (key === 'cache_hit_rate') continue
      addUsageCounter(totals, key, numberValue(bucket[key]))
    }
    const threadId = stringField(bucket, 'thread_id')
    if (threadId) threadIds.add(threadId)
    const count = numberValue(bucket.thread_count)
    if (count > 0 && !threadId) addUsageCounter(totals, 'thread_count', count)
  }
  if (threadIds.size) totals.thread_count = threadIds.size
  totals.cache_hit_rate = numberValue(totals.input_tokens) > 0
    ? numberValue(totals.cached_tokens) / numberValue(totals.input_tokens)
    : null
  return totals
}

function usageBucketHasActivity(bucket: Record<string, unknown>): boolean {
  return numberValue(bucket.total_tokens) > 0 || numberValue(bucket.turns) > 0
}

function fillUsageDays(from: string, to: string, buckets: Map<string, Record<string, unknown>>): Array<Record<string, unknown>> {
  if (!isDateKey(from) || !isDateKey(to)) {
    return [...buckets.values()].sort((a, b) => stringField(a, 'date').localeCompare(stringField(b, 'date')))
  }
  const result: Array<Record<string, unknown>> = []
  let current = from
  while (current <= to) {
    result.push(buckets.get(current) ?? { ...zeroUsageCounters(), date: current })
    current = addUtcDay(current)
  }
  return result
}

function dateInRange(date: string, from: string, to: string): boolean {
  if (isDateKey(from) && date < from) return false
  if (isDateKey(to) && date > to) return false
  return true
}

function dateInTimezone(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    // Fall back to UTC when the client sends a timezone this Node runtime does not know.
  }
  return date.toISOString().slice(0, 10)
}

function addUtcDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function upsertLocalGoal(threadId: string, body: Record<string, unknown>): Record<string, unknown> | null {
  const existing = localGoals.get(threadId)
  const objective = stringField(body, 'objective') || stringField(existing ?? {}, 'objective')
  if (!objective) return null
  const now = new Date().toISOString()
  const rawStatus = stringField(body, 'status') || stringField(existing ?? {}, 'status') || 'active'
  const status = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(rawStatus)
    ? rawStatus
    : 'active'
  const tokenBudgetValue = body.tokenBudget
  const goal = {
    threadId,
    objective,
    status,
    tokenBudget: tokenBudgetValue === null || typeof tokenBudgetValue === 'number'
      ? tokenBudgetValue
      : existing?.tokenBudget ?? null,
    tokensUsed: typeof existing?.tokensUsed === 'number' ? existing.tokensUsed : 0,
    timeUsedSeconds: typeof existing?.timeUsedSeconds === 'number' ? existing.timeUsedSeconds : 0,
    createdAt: stringField(existing ?? {}, 'createdAt') || now,
    updatedAt: now
  }
  localGoals.set(threadId, goal)
  return goal
}

function setLocalTodos(threadId: string, rawItems: unknown[]): Record<string, unknown> {
  const now = new Date().toISOString()
  const previousById = new Map(
    (Array.isArray(localTodos.get(threadId)?.items) ? localTodos.get(threadId)?.items as unknown[] : [])
      .map((item) => [stringField(asRecord(item), 'id'), asRecord(item)])
  )
  const items = rawItems
    .map((raw, index) => {
      const item = asRecord(raw)
      const content = stringField(item, 'content')
      if (!content) return null
      const id = stringField(item, 'id') || `todo_${index}_${shortHash(content)}`
      const previous = previousById.get(id)
      return {
        id,
        content,
        status: normalizeTodoStatus(stringField(item, 'status')),
        ...(asRecord(item.source).kind ? { source: item.source } : {}),
        createdAt: stringField(previous ?? {}, 'createdAt') || now,
        updatedAt: now
      }
    })
    .filter((item) => item !== null)
  const todos = { threadId, items, updatedAt: now }
  localTodos.set(threadId, todos)
  return todos
}

function mapMimoTodos(threadId: string, rawItems: unknown[]): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    threadId,
    items: rawItems
      .map((raw, index) => {
        const item = asRecord(raw)
        const content = stringField(item, 'content')
        if (!content) return null
        return {
          id: `mimo_todo_${index}_${shortHash(content)}`,
          content,
          status: normalizeTodoStatus(stringField(item, 'status')),
          createdAt: now,
          updatedAt: now
        }
      })
      .filter((item) => item !== null),
    updatedAt: now
  }
}

function kunTodosToMimoTodos(rawItems: unknown[]): Array<Record<string, string>> {
  return rawItems
    .map((raw) => {
      const item = asRecord(raw)
      const content = stringField(item, 'content')
      if (!content) return null
      return {
        content,
        status: normalizeTodoStatus(stringField(item, 'status'))
      }
    })
    .filter((item) => item !== null)
}

function mapMimoGoal(threadId: string, value: unknown): Record<string, unknown> | null {
  const goal = asRecord(value)
  const condition = stringField(goal, 'condition')
  if (!condition) return null
  return upsertLocalGoal(threadId, {
    objective: condition,
    status: 'active'
  })
}

function normalizeTodoStatus(value: string): string {
  if (value === 'in_progress' || value === 'completed') return value
  return 'pending'
}

function kunAnswersToMimoAnswers(rawAnswers: unknown[]): string[][] {
  const labels = rawAnswers
    .map((answer) => {
      const record = asRecord(answer)
      return stringField(record, 'label') || stringField(record, 'value') || stringField(record, 'id')
    })
    .filter(Boolean)
  return [labels]
}

function mapMimoQuestions(rawQuestions: unknown[]): Array<Record<string, unknown>> {
  return rawQuestions.map((raw, index) => {
    const question = asRecord(raw)
    return {
      header: stringField(question, 'header') || `Question ${index + 1}`,
      id: stringField(question, 'id') || `question_${index + 1}`,
      question: stringField(question, 'question') || stringField(question, 'header') || 'Input requested',
      options: Array.isArray(question.options)
        ? question.options.map((option) => {
            const record = asRecord(option)
            return {
              label: stringField(record, 'label') || stringField(record, 'description') || 'Option',
              description: stringField(record, 'description')
            }
          })
        : []
    }
  })
}

function permissionSummary(properties: Record<string, unknown>): string {
  const permission = stringField(properties, 'permission')
  const patterns = Array.isArray(properties.patterns)
    ? properties.patterns.map((pattern) => typeof pattern === 'string' ? pattern : '').filter(Boolean)
    : []
  return [permission, ...patterns].filter(Boolean).join(' ') || 'Permission requested'
}

function shortHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function effectiveMimoCredentials(settings: AppSettingsV1) {
  const runtime = getKunRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const providerKey = provider.apiKey.trim()
  if (!providerKey) return runtime.mimo

  const providerBaseUrl = provider.baseUrl.trim()
  const selectedModel = runtime.model.trim()
  return normalizeMimoCredentialSettings({
    ...runtime.mimo,
    mode: providerBaseUrl.includes('token-plan') ? 'tokenplan' : 'recharge',
    apiKey: providerKey,
    baseUrl: providerBaseUrl || runtime.mimo.baseUrl,
    model: selectedModel || runtime.mimo.model
  })
}

async function mimoWorkCoreConfigContent(
  settings: AppSettingsV1,
  mimo: ReturnType<typeof effectiveMimoCredentials>
): Promise<Record<string, unknown>> {
  const providerPatch = withMimoWorkBuildAgentPolicy(asRecord(mimoCredentialProviderConfigPatch(mimo)))
  const roots = await guiSkillRootsForRuntime(settings).catch(() => [])
  const paths = roots.map((root) => root.path).filter(Boolean)
  if (!paths.length) return providerPatch

  const existingSkills = asRecord(providerPatch.skills)
  const existingPaths = Array.isArray(existingSkills.paths)
    ? existingSkills.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  return {
    ...providerPatch,
    skills: {
      ...existingSkills,
      paths: [...new Set([...existingPaths, ...paths])]
    }
  }
}

function withMimoWorkBuildAgentPolicy(config: Record<string, unknown>): Record<string, unknown> {
  const agent = asRecord(config.agent)
  const build = asRecord(agent.build)
  const tools = asRecord(build.tools)
  const permission = asRecord(build.permission)
  return {
    ...config,
    agent: {
      ...agent,
      build: {
        ...build,
        tool_allowlist: MIMO_WORK_BUILD_TOOL_ALLOWLIST,
        tools: {
          ...tools,
          write: false
        },
        permission: {
          ...permission,
          edit: 'deny'
        }
      }
    }
  }
}

export const mimoWorkAdapterTestInternals = {
  buildPromptParts,
  createLocalAttachment,
  createLocalMemory,
  effectiveMimoCredentials,
  mapMimoTodos,
  mapMimoMessageSnapshotEvents,
  mimoBinaryCandidates,
  mimoBinaryName,
  mimoCoreArch,
  mimoWorkCoreConfigContent,
  mimoCoreChildEnv,
  mimoCorePlatform,
  mimoRuntimeSpawnOptions,
  mimoWorkPromptToolOverrides: () => MIMO_WORK_REQUEST_TOOL_OVERRIDES,
  promptFromBody,
  resetLocalAdapterStateForTests,
  resolveLaunch,
  reviewPrompt,
  runtimeCapabilities,
  runtimeStreamFailedEvent,
  sessionToThread,
  shouldAutoApproveMimoPermission,
  stripMimoWorkInternalText,
  stripWorkspaceRuntimePrompt,
  stalledWriteRecoveryPrompt,
  syntheticQuestionFollowupPrompt,
  withWorkspaceRuntimePrompt,
  visiblePromptFromBody,
  visibleUserPromptText,
  messagesToTurns,
  mapMimoEvent
}

function resetLocalAdapterStateForTests(): void {
  localAttachments.clear()
  localMemories.clear()
  localThreadMetadata.clear()
  localGoals.clear()
  localTodos.clear()
  latestSeq.clear()
  replayEvents.clear()
  messageRoleById.clear()
  partMessageRoleById.clear()
  partTypeById.clear()
  partTextById.clear()
  partRawTextById.clear()
  partFingerprintById.clear()
  pendingQuestionFingerprintById.clear()
  autoApprovedPermissionIds.clear()
  syntheticQuestionInputs.clear()
  resolvedSyntheticQuestionInputs.clear()
  pendingSnapshotSinceByThread.clear()
  completedSnapshotMessages.clear()
  failedSnapshotMessages.clear()
  recoveredStalledRuntimeTools.clear()
  localStatePath = ''
  lastInjectedMemoryIds = []
}
