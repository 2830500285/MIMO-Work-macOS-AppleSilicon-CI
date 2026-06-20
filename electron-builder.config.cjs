const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const afterPack = require('./scripts/after-pack.cjs')

function envValue(name) {
  const value = process.env[name]
  return value !== undefined && value !== '' ? value : undefined
}

function loadLocalReleaseEnv() {
  const candidates = [
    envValue('MIMO_WORK_RELEASE_ENV'),
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || 'https://www.mimo-work.local/api/r2')
  .trim()
  .replace(/\/+$/, '')
const r2ReleasePrefix = (process.env.R2_RELEASE_PREFIX || 'mimo-work')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const updateChannel = normalizeUpdateChannel(
  envValue('MIMO_WORK_UPDATE_CHANNEL') || 'stable'
)
const genericUpdateUrl = `${r2PublicBaseUrl}/${r2ReleasePrefix}/channels/${updateChannel}/latest/`
const releaseAppVersion = (
  envValue('MIMO_WORK_APP_VERSION') || ''
).trim()
const artifactVersion = releaseAppVersion || '${version}'
const mimoCoreDir = process.env.MIMO_WORK_CORE_DIR || join(__dirname, '..', 'MIMO-Work-Core')
const mimoWorkSkillDir = join(__dirname, 'resources', 'skills')
const mimoCoreExtraResources = existsSync(mimoCoreDir)
  ? [
      {
        from: mimoCoreDir,
        to: 'MIMO-Work-Core',
        filter: [
          'package.json',
          'packages/opencode/dist/**/*',
          '!packages/opencode/dist/mimocode-windows-arm64*/**',
          '!**/.git/**',
          '!**/.artifacts/**',
          '!**/coverage/**',
          '!**/test-results/**',
          '!**/*.map'
        ]
      }
    ]
  : []
const mimoWorkSkillExtraResources = existsSync(mimoWorkSkillDir)
  ? [
      {
        from: mimoWorkSkillDir,
        to: 'MIMO-Work-Skills'
      }
    ]
  : []

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`MIMO_WORK_UPDATE_CHANNEL must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !/^\d+\.\d+\.\d+$/.test(releaseAppVersion)) {
  throw new Error(
    `MIMO_WORK_APP_VERSION must be a valid x.y.z semver for electron-updater, got: ${releaseAppVersion}`
  )
}

module.exports = {
  // MIMO Work ships with its own bundle identifier.
  appId: 'com.mimowork.desktop',
  productName: 'MIMO Work',
  asar: true,
  asarUnpack: [
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*'
  ],
  npmRebuild: true,
  directories: {
    output: envValue('MIMO_WORK_DIST_DIR') || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*'
    // node_modules/openclaw (the vendor/openclaw-shim file: dep) must ship:
    // the WeChat bridge imports @tencent-weixin/openclaw-weixin/dist at
    // runtime to send media, and that chain resolves openclaw/plugin-sdk/*.
  ],
  extraResources: [...mimoCoreExtraResources, ...mimoWorkSkillExtraResources],
  artifactName: `MIMO-Work-${artifactVersion}-\${os}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: genericUpdateUrl
    }
  ],
  afterPack,
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      // 语音输入：渲染进程通过 getUserMedia 录音做语音转文字。
      NSMicrophoneUsageDescription: 'MIMO Work uses the microphone for voice-to-text input.'
    },
    // macOS 不会自动套圆角遮罩,图标文件本身需要是「圆角方块 + 透明边距」
    icon: './src/asset/img/mimo-work-mac.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity
  },
  win: {
    // Windows does not mask app icons for us; use the rounded asset so
    // desktop/start-menu/taskbar shortcuts do not show a hard square edge.
    // Ship a multi-size .ico (16/24/32/48/64/72/96/128/256) so Explorer and
    // the desktop render crisp icons at small sizes (#222). Regenerate with:
    // npx --yes png2icons src/asset/img/mimo-work-mac.png build/icon -icowe -bc
    icon: './build/icon.ico',
    executableName: 'MIMO Work',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] }
    ]
  },
  nsis: {
    artifactName: `MIMO-Work-${artifactVersion}-win-\${arch}-setup.\${ext}`,
    buildUniversalInstaller: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'MIMO Work',
    uninstallDisplayName: 'MIMO Work',
    deleteAppDataOnUninstall: false
  },
  portable: {
    artifactName: `MIMO-Work-${artifactVersion}-win-\${arch}-portable.\${ext}`,
    buildUniversalInstaller: false
  },
  linux: {
    category: 'Development',
    icon: './src/asset/img/mimo-work.png',
    target: [{ target: 'AppImage', arch: ['x64'] }]
  },
  extraMetadata: {
    ...(releaseAppVersion ? { version: releaseAppVersion } : {}),
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    }
  }
}
