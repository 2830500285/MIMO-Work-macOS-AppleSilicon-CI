import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectGithubDirectoryFiles,
  installRecommendedSkillPackage,
  recommendedSkillPackageForTest
} from './recommended-skill-install-service'

const tempRoots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mimo-recommended-skill-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('recommended skill install service', () => {
  it('downloads a whitelisted GitHub skill directory into the MIMO Work skill root', async () => {
    const targetRoot = await tempRoot()
    const fetchImpl = fakeGithubFetch({
      'https://api.github.com/repos/NousResearch/hermes-agent/contents/skills/software-development?ref=main': [
        {
          type: 'dir',
          path: 'skills/software-development/test-driven-development'
        }
      ],
      'https://api.github.com/repos/NousResearch/hermes-agent/contents/skills/software-development/test-driven-development?ref=main': [
        {
          type: 'file',
          path: 'skills/software-development/test-driven-development/SKILL.md',
          size: 70,
          download_url: 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/skills/software-development/test-driven-development/SKILL.md'
        }
      ],
      'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/skills/software-development/test-driven-development/SKILL.md': [
        '---',
        'name: test-driven-development',
        'description: Write tests first.',
        '---',
        '',
        'Use TDD.'
      ].join('\n')
    })

    const result = await installRecommendedSkillPackage('hermes-software-development', {
      fetchImpl,
      targetRoot
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      fileCount: 1,
      sourceUrl: expect.stringContaining('NousResearch/hermes-agent')
    }))
    if (!result.ok) return
    await expect(readFile(
      join(result.path, 'test-driven-development', 'SKILL.md'),
      'utf8'
    )).resolves.toContain('name: test-driven-development')
  })

  it('rejects unknown recommendation ids instead of accepting arbitrary repos', async () => {
    const result = await installRecommendedSkillPackage('private-local-skill', {
      fetchImpl: fakeGithubFetch({})
    })

    expect(result).toEqual({
      ok: false,
      message: 'Unknown recommended Skill package.'
    })
  })

  it('collects nested GitHub skill files and trims the source directory prefix', async () => {
    const item = recommendedSkillPackageForTest('hermes-software-development')
    expect(item).toBeTruthy()
    if (!item) return
    const files = await collectGithubDirectoryFiles(item.github, fakeGithubFetch({
      'https://api.github.com/repos/NousResearch/hermes-agent/contents/skills/software-development?ref=main': [
        {
          type: 'file',
          path: 'skills/software-development/plan/SKILL.md',
          size: 32,
          download_url: 'https://raw.githubusercontent.com/plan/SKILL.md'
        }
      ],
      'https://raw.githubusercontent.com/plan/SKILL.md': '---\nname: plan\n---\n'
    }))

    expect(files).toEqual([
      {
        relativePath: 'plan/SKILL.md',
        content: Buffer.from('---\nname: plan\n---\n')
      }
    ])
  })
})

function fakeGithubFetch(fixtures: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const fixture = fixtures[url]
    if (fixture === undefined) {
      return new Response('not found', { status: 404 })
    }
    if (typeof fixture === 'string') {
      return new Response(fixture, { status: 200 })
    }
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
}
