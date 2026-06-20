import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import {
  buildSidebarChatThreads,
  buildSidebarDraftWorkspacePaths,
  buildSidebarWorkspaceGroups,
  filterEmptySddAssistantThreadsFromSidebar,
  filterSddDraftHistoryItems,
  mergeSidebarWorkspaceGroupsWithDraftHistory,
  SddDraftHistoryRows,
  ThreadRenameDialog
} from './SidebarProjectsSection'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    model: overrides.model ?? 'reasonix',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    ...(overrides.latestTurnId ? { latestTurnId: overrides.latestTurnId } : {}),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

function draft(overrides: Partial<SddDraftHistoryItem> & Pick<SddDraftHistoryItem, 'id' | 'title'>): SddDraftHistoryItem {
  const folder = overrides.id.replace(/[^a-z0-9-]/gi, '').slice(0, 36).padEnd(36, '0')
  return {
    id: overrides.id,
    workspaceRoot: overrides.workspaceRoot ?? '/tmp/app',
    relativePath: overrides.relativePath ?? `.kunsdd/draft/${folder}/requirement.md`,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-02T00:00:00.000Z',
    title: overrides.title,
    source: overrides.source ?? 'remembered',
    ...(overrides.chatThreadIds ? { chatThreadIds: overrides.chatThreadIds } : {}),
    ...(overrides.searchText ? { searchText: overrides.searchText } : {})
  }
}

describe('SidebarProjectsSection groups', () => {
  it('keeps remembered code workspaces visible even when the runtime lists only one workspace', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/project-b',
        '/Users/zxy/project-c'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b',
      '/Users/zxy/project-c'
    ])
    expect(groups[1]?.[1]).toEqual([])
    expect(groups[2]?.[1]).toEqual([])
  })

  it('does not show registry-only empty workspaces while searching or viewing archives', () => {
    const base = {
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: ['/Users/zxy/project-b']
    }

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: 'project',
        showArchived: false
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: '',
        showArchived: true
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])
  })

  it('hides the default chat workspace while filtering write workspaces from code project groups', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'default-code', workspace: '/Users/zxy/.mimo-work/default_workspace' }),
        thread({ id: 'write-assistant', workspace: '~/.mimo-work/write_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/.mimo-work/default_workspace',
        '~/.mimo-work/write_workspace'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a'
    ])
  })

  it('shows default workspace threads in the chat section instead of projects', () => {
    const chats = buildSidebarChatThreads({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'default-code', workspace: '/Users/zxy/.mimo-work/default_workspace' }),
        thread({ id: 'default-short', workspace: '~/.mimo-work/default_workspace' }),
        thread({ id: 'write-assistant', workspace: '~/.mimo-work/write_workspace' })
      ],
      searchQuery: '',
      showArchived: false
    })

    expect(chats.map((item) => item.id)).toEqual(['default-code', 'default-short'])
  })

  it('does not create a project group for default workspace aliases', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'default-short', workspace: '~/.mimo-work/default_workspace' }),
        thread({ id: 'default-absolute', workspace: 'C:\\Users\\zxy\\.mimo-work\\default_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: 'C:\\Users\\zxy\\.mimo-work\\default_workspace',
      workspaceRoots: [
        '~/.mimo-work/default_workspace',
        'C:\\Users\\zxy\\.mimo-work\\default_workspace'
      ]
    })

    expect(groups).toEqual([])
  })

  it('loads requirement histories from all known project workspaces while searching', () => {
    const workspaces = buildSidebarDraftWorkspacePaths({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'write-assistant', workspace: '~/.mimo-work/write_workspace' })
      ],
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/project-b',
        '~/.mimo-work/write_workspace'
      ]
    })

    expect(workspaces).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b'
    ])
  })

  it('merges requirement-only search matches into displayed groups', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      searchQuery: 'checkout',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: ['/Users/zxy/project-a', '/Users/zxy/project-b']
    })
    const filteredDraftHistory = {
      '/Users/zxy/project-b': [draft({
        id: 'draft-checkout',
        title: 'Checkout requirement',
        workspaceRoot: '/Users/zxy/project-b'
      })]
    }

    const displayGroups = mergeSidebarWorkspaceGroupsWithDraftHistory({
      groups,
      draftHistoryByWorkspace: filteredDraftHistory,
      workspaceRoot: '/Users/zxy/project-a'
    })

    expect(displayGroups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b'
    ])
  })

  it('filters requirement drafts by title, path, workspace, and content', () => {
    const items = [
      draft({ id: 'draft-login', title: 'Login requirement', searchText: 'Support passkey sign-in.' }),
      draft({ id: 'draft-export', title: 'Export requirement', searchText: 'Download reports as CSV.' })
    ]

    expect(filterSddDraftHistoryItems(items, 'passkey', '/tmp/app').map((item) => item.id)).toEqual(['draft-login'])
    expect(filterSddDraftHistoryItems(items, 'export', '/tmp/app').map((item) => item.id)).toEqual(['draft-export'])
    expect(filterSddDraftHistoryItems(items, 'tmp', '/tmp/app')).toHaveLength(2)
  })

  it('filters empty Requirement AI backing threads recorded in draft history', () => {
    const hidden = thread({
      id: 'thread-sdd-empty',
      title: 'Checkout requirement',
      workspace: '/tmp/app'
    })
    const visibleNormal = thread({
      id: 'thread-normal',
      title: 'Checkout requirement',
      workspace: '/tmp/app'
    })
    const visibleWithTurn = thread({
      id: 'thread-sdd-active-build',
      title: 'Checkout requirement',
      workspace: '/tmp/app',
      latestTurnId: 'turn-1'
    })
    const items = [
      draft({
        id: 'draft-checkout',
        title: 'Checkout requirement',
        chatThreadIds: ['thread-sdd-empty', 'thread-sdd-active-build']
      })
    ]

    expect(
      filterEmptySddAssistantThreadsFromSidebar([hidden, visibleNormal, visibleWithTurn], items)
        .map((item) => item.id)
    ).toEqual(['thread-normal', 'thread-sdd-active-build'])
  })
})

describe('ThreadRenameDialog', () => {
  it('renders an in-app rename form with the current thread title prefilled', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadRenameDialog, {
        state: {
          thread: thread({
            id: 'thr_rename',
            title: 'Build rename dialog',
            workspace: '/Users/zxy/project-a'
          }),
          value: 'Build rename dialog',
          submitting: false
        },
        onClose: vi.fn(),
        onValueChange: vi.fn(),
        onSubmit: vi.fn(),
        t: (key: string) => key
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('sidebarThreadRename')
    expect(html).toContain('value="Build rename dialog"')
    expect(html).toContain('type="submit" disabled=""')
  })
})

describe('SddDraftHistoryRows', () => {
  it('renders requirement draft history fully collapsed by default', () => {
    const html = renderToStaticMarkup(
      createElement(SddDraftHistoryRows, {
        items: [
          draft({ id: 'draft-1', title: 'Requirement 1' }),
          draft({ id: 'draft-2', title: 'Requirement 2' }),
          draft({ id: 'draft-3', title: 'Requirement 3' }),
          draft({ id: 'draft-4', title: 'Requirement 4' })
        ],
        activeDraftId: '',
        onOpen: vi.fn(),
        t: (key: string, opts?: Record<string, unknown>) =>
          key === 'sddDraftHistoryOpen'
            ? `Open ${String(opts?.title)}`
            : key === 'sddDraftHistoryShowMore'
              ? `Show ${String(opts?.count)} more`
              : key
      })
    )

    expect(html).toContain('sddDraftHistoryTitle')
    expect(html).toContain('sddDraftHistoryExpand')
    expect(html).toContain('>4<')
    expect(html).not.toContain('Requirement 1')
    expect(html).not.toContain('Requirement 2')
    expect(html).not.toContain('Requirement 3')
    expect(html).not.toContain('Requirement 4')
    expect(html).not.toContain('Open Requirement 1')
    expect(html).not.toContain('Show 1 more')
  })
})
