import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import {
  findRecommendedSkillPackage,
  type RecommendedGithubDirectory,
  type RecommendedSkillPackage
} from '../../shared/recommended-marketplace'

export type RecommendedSkillInstallResult =
  | { ok: true; path: string; fileCount: number; sourceUrl: string }
  | { ok: false; message: string }

type FetchLike = typeof fetch

type GithubContentItem = {
  type?: string
  name?: string
  path?: string
  size?: number
  download_url?: string | null
}

const MAX_RECOMMENDED_SKILL_FILES = 600
const MAX_RECOMMENDED_SKILL_FILE_BYTES = 2 * 1024 * 1024
const MAX_RECOMMENDED_SKILL_TOTAL_BYTES = 32 * 1024 * 1024

export async function installRecommendedSkillPackage(
  id: string,
  options: {
    fetchImpl?: FetchLike
    targetRoot?: string
  } = {}
): Promise<RecommendedSkillInstallResult> {
  const item = findRecommendedSkillPackage(id)
  if (!item) return { ok: false, message: 'Unknown recommended Skill package.' }

  try {
    const targetRoot = options.targetRoot ?? join(homedir(), '.mimo-work', 'skills')
    const targetDir = join(targetRoot, ...safeDestinationSegments(item.destinationName))
    const files = await collectGithubDirectoryFiles(item.github, options.fetchImpl ?? fetch)
    await rm(targetDir, { recursive: true, force: true })
    for (const file of files) {
      const relativePath = safeRelativeFilePath(file.relativePath)
      const targetPath = join(targetDir, ...relativePath)
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, file.content)
    }
    return {
      ok: true,
      path: targetDir,
      fileCount: files.length,
      sourceUrl: item.sourceUrl
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function collectGithubDirectoryFiles(
  directory: RecommendedGithubDirectory,
  fetchImpl: FetchLike = fetch
): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const files: Array<{ relativePath: string; content: Buffer }> = []
  let totalBytes = 0

  const visit = async (path: string): Promise<void> => {
    if (files.length >= MAX_RECOMMENDED_SKILL_FILES) {
      throw new Error('Recommended Skill package has too many files.')
    }
    const items = await fetchGithubContentList(directory, path, fetchImpl)
    for (const item of items) {
      if (item.type === 'dir' && item.path) {
        await visit(item.path)
        continue
      }
      if (item.type !== 'file' || !item.path || !item.download_url) continue
      const size = typeof item.size === 'number' ? item.size : 0
      if (size > MAX_RECOMMENDED_SKILL_FILE_BYTES) {
        throw new Error(`Recommended Skill file is too large: ${item.path}`)
      }
      totalBytes += size
      if (totalBytes > MAX_RECOMMENDED_SKILL_TOTAL_BYTES) {
        throw new Error('Recommended Skill package is too large.')
      }
      const response = await fetchImpl(item.download_url)
      if (!response.ok) {
        throw new Error(`Failed to download ${item.path}: HTTP ${response.status}`)
      }
      const content = Buffer.from(await response.arrayBuffer())
      files.push({
        relativePath: trimGithubDirectoryPrefix(directory.path, item.path),
        content
      })
    }
  }

  await visit(directory.path)
  if (!files.some((file) => file.relativePath.endsWith('SKILL.md'))) {
    throw new Error('Recommended Skill package did not contain a SKILL.md file.')
  }
  return files
}

async function fetchGithubContentList(
  directory: RecommendedGithubDirectory,
  path: string,
  fetchImpl: FetchLike
): Promise<GithubContentItem[]> {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(directory.owner)}/${encodeURIComponent(directory.repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
  )
  url.searchParams.set('ref', directory.ref)
  const response = await fetchImpl(url.toString(), {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'MIMO-Work'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to list recommended Skill package: HTTP ${response.status}`)
  }
  const body = await response.json() as unknown
  if (!Array.isArray(body)) {
    throw new Error('Recommended Skill source is not a GitHub directory.')
  }
  return body.filter(isGithubContentItem)
}

function isGithubContentItem(value: unknown): value is GithubContentItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimGithubDirectoryPrefix(rootPath: string, filePath: string): string {
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = filePath.replace(/\\/g, '/')
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
}

function safeDestinationSegments(destinationName: string): string[] {
  const segments = destinationName
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(safePathSegment)
  if (segments.length === 0) throw new Error('Invalid recommended Skill destination.')
  return segments
}

function safeRelativeFilePath(relativePath: string): string[] {
  const segments = relativePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(safePathSegment)
  if (segments.length === 0) throw new Error('Invalid recommended Skill file path.')
  return segments
}

function safePathSegment(segment: string): string {
  const value = segment.replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!value || value === '.' || value === '..') {
    throw new Error('Invalid recommended Skill path segment.')
  }
  return value
}

export function recommendedSkillPackageForTest(id: string): RecommendedSkillPackage | undefined {
  return findRecommendedSkillPackage(id)
}
