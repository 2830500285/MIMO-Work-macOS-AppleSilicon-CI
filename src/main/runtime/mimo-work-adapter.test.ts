import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/MIMO-Work-Shell'
  }
}))

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(9988),
        runtimeEngine: 'mimo-work',
        mimo: {
          ...defaultKunRuntimeSettings().mimo,
          model: 'mimo-v2.5-pro'
        }
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('mimo work adapter contract mapping', () => {
  it('maps MiMo sessions to Kun thread summaries', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    expect(mimoWorkAdapterTestInternals.sessionToThread(settings(), {
      id: 'ses_1',
      title: 'Build app',
      directory: '/tmp/project',
      time: { created: 1_700_000_000_000, updated: 1_700_000_001_000 }
    })).toMatchObject({
      id: 'ses_1',
      title: 'Build app',
      workspace: '/tmp/project',
      model: 'mimo-v2.5-pro',
      status: 'idle',
      relation: 'primary'
    })
  })

  it('reuses the selected Xiaomi Tokenplan provider as MiMo credentials', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const current = settings()
    current.provider.providers.push({
      id: 'xiaomi-token-plan',
      name: 'Xiaomi Tokenplan',
      apiKey: 'tp-unit-test-key-12345678901234567890',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      endpointFormat: 'chat_completions',
      models: ['mimo-v2.5-pro'],
      modelProfiles: {
        'mimo-v2.5-pro': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    })
    current.agents.kun.providerId = 'xiaomi-token-plan'
    current.agents.kun.model = 'mimo-v2.5-pro'
    current.agents.kun.mimo.apiKey = ''
    current.provider.apiKey = 'tp-unit-test-key-12345678901234567890'
    current.provider.baseUrl = 'https://token-plan-sgp.xiaomimimo.com/v1'

    expect(mimoWorkAdapterTestInternals.effectiveMimoCredentials(current)).toMatchObject({
      mode: 'tokenplan',
      apiKey: 'tp-unit-test-key-12345678901234567890',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro'
    })
  })

  it('uses the environment MiMo API key when settings do not store one', async () => {
    const previous = process.env.MIMO_WORK_MIMO_API_KEY
    process.env.MIMO_WORK_MIMO_API_KEY = 'tp-env-unit-test-key-12345678901234567890'
    try {
      const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
      const current = settings()
      current.agents.kun.mimo.apiKey = ''

      expect(mimoWorkAdapterTestInternals.effectiveMimoCredentials(current)).toMatchObject({
        apiKey: 'tp-env-unit-test-key-12345678901234567890',
        model: 'mimo-v2.5-pro'
      })
    } finally {
      if (previous === undefined) {
        delete process.env.MIMO_WORK_MIMO_API_KEY
      } else {
        process.env.MIMO_WORK_MIMO_API_KEY = previous
      }
    }
  })

  it('uses the selected custom provider credentials for MiMo core requests', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const current = settings()
    current.provider.providers.push({
      id: 'custom-provider-2',
      name: 'Custom Provider 2',
      apiKey: 'sk-custom-provider-key',
      baseUrl: 'http://127.0.0.1:9797/v1',
      endpointFormat: 'chat_completions',
      models: ['provider:prov_custom:mimo-v2.5'],
      modelProfiles: {
        'provider:prov_custom:mimo-v2.5': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    })
    current.agents.kun.providerId = 'custom-provider-2'
    current.agents.kun.model = 'provider:prov_custom:mimo-v2.5'
    current.agents.kun.mimo.apiKey = 'tp-old-tokenplan-key-12345678901234567890'

    const mimo = mimoWorkAdapterTestInternals.effectiveMimoCredentials(current)

    expect(mimo).toMatchObject({
      mode: 'recharge',
      apiKey: 'sk-custom-provider-key',
      baseUrl: 'http://127.0.0.1:9797/v1',
      model: 'provider:prov_custom:mimo-v2.5'
    })
  })

  it('maps MiMo messages to Kun turn skeletons with assistant text', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const turns = mimoWorkAdapterTestInternals.messagesToTurns(settings(), 'ses_1', [
      {
        info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_000 } },
        parts: [{ type: 'text', text: 'hello' }]
      },
      {
        info: { id: 'msg_assistant', role: 'assistant', parentID: 'msg_user', time: { created: 1_700_000_001_000 } },
        parts: [{ id: 'part_text', type: 'text', text: 'world' }]
      }
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      id: 'msg_user',
      prompt: 'hello',
      items: expect.arrayContaining([
        expect.objectContaining({ kind: 'user_message', text: 'hello' }),
        expect.objectContaining({ kind: 'assistant_text', text: 'world' })
      ])
    })
  })

  it('accepts legacy input fields without turning an empty prompt into runtime context', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')

    expect(mimoWorkAdapterTestInternals.promptFromBody({ input: '只回复 OK' })).toBe('只回复 OK')
    expect(mimoWorkAdapterTestInternals.promptFromBody({ prompt: '' })).toBe('')
    expect(mimoWorkAdapterTestInternals.visiblePromptFromBody({ displayText: '用户可见文本' }, '内部提示词')).toBe('用户可见文本')
  })

  it('shows only the current user request when MiMo stores managed prompt wrappers', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const managedPrompt = [
      '[Code managed instructions]',
      'MIMO Work execution guardrails:',
      '- Keep visible progress moving.',
      '',
      '---',
      '[Current user request] 打开该文件'
    ].join('\n')
    const turns = mimoWorkAdapterTestInternals.messagesToTurns(settings(), 'ses_managed_prompt', [
      {
        info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_000 } },
        parts: [{ type: 'text', text: managedPrompt }]
      }
    ])

    expect(turns[0]).toMatchObject({
      prompt: '打开该文件',
      items: [expect.objectContaining({ kind: 'user_message', text: '打开该文件' })]
    })
    expect(mimoWorkAdapterTestInternals.visibleUserPromptText(managedPrompt)).toBe('打开该文件')
  })

  it('maps assistant message errors to visible failed turn items', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const turns = mimoWorkAdapterTestInternals.messagesToTurns(settings(), 'ses_error', [
      {
        info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_000 } },
        parts: [{ type: 'text', text: 'hello' }]
      },
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          parentID: 'msg_user',
          time: { created: 1_700_000_001_000, completed: 1_700_000_001_500 },
          error: {
            name: 'APIError',
            data: {
              message: 'Invalid API Key',
              param: 'Please provide valid API Key',
              statusCode: 401
            }
          }
        },
        parts: []
      }
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      id: 'msg_user',
      status: 'failed',
      items: expect.arrayContaining([
        expect.objectContaining({ kind: 'error', code: 'mimo_assistant_error', message: expect.stringContaining('Invalid API Key') })
      ])
    })
  })

  it('injects workspace context into runtime prompts without changing the visible user prompt', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const prompt = '请生成 Word 文档'
    const runtimePrompt = mimoWorkAdapterTestInternals.withWorkspaceRuntimePrompt('/tmp/project', prompt)

    expect(runtimePrompt).toContain('/tmp/project')
    expect(runtimePrompt).toContain('项目工作区')
    expect(runtimePrompt.endsWith(prompt)).toBe(true)
    expect(mimoWorkAdapterTestInternals.stripWorkspaceRuntimePrompt(runtimePrompt)).toBe(prompt)
    expect(mimoWorkAdapterTestInternals.withWorkspaceRuntimePrompt('', prompt)).toBe(prompt)
  })

  it('strips internal runtime context from assistant-visible text', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const leaked = [
      'MIMO Work runtime context / 本轮执行上下文:',
      '- Workspace/project directory / 项目工作区: /tmp/project',
      '',
      '[Code managed instructions]',
      'MIMO Work execution guardrails:',
      '- Do not pass workdir/cwd fields to bash.',
      '[Current user request] 你好'
    ].join('\n')
    expect(mimoWorkAdapterTestInternals.stripMimoWorkInternalText(leaked)).toBe('')

    const leakedWithAnswer = `${leaked}\n你好！有什么可以帮你？`
    expect(mimoWorkAdapterTestInternals.stripMimoWorkInternalText(leakedWithAnswer)).toBe('你好！有什么可以帮你？')

    const turns = mimoWorkAdapterTestInternals.messagesToTurns(settings(), 'ses_internal', [
      {
        info: { id: 'msg_user', role: 'user', time: { created: 1_700_000_000_000 } },
        parts: [{ id: 'part_user', type: 'text', text: '你好' }]
      },
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          parentID: 'msg_user',
          time: { created: 1_700_000_001_000 }
        },
        parts: [{ id: 'part_reasoning', type: 'reasoning', text: leaked }]
      }
    ])
    expect(turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'user_message', text: '你好' })
    ])
  })

  it('treats full access plus auto approval as auto-approvable MiMo permissions', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const current = settings()
    current.agents.kun.approvalPolicy = 'auto'
    current.agents.kun.sandboxMode = 'danger-full-access'
    expect(mimoWorkAdapterTestInternals.shouldAutoApproveMimoPermission(current)).toBe(true)

    current.agents.kun.approvalPolicy = 'on-request'
    expect(mimoWorkAdapterTestInternals.shouldAutoApproveMimoPermission(current)).toBe(false)

    current.agents.kun.approvalPolicy = 'auto'
    current.agents.kun.sandboxMode = 'workspace-write'
    expect(mimoWorkAdapterTestInternals.shouldAutoApproveMimoPermission(current)).toBe(false)
  })

  it('filters MiMo global events to a thread and synthesizes Kun seq values', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_1', {
      type: 'session.status',
      properties: { sessionID: 'other', status: 'busy' }
    })).toBeNull()
    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_1', {
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: 'busy' }
    })).toMatchObject({
      seq: expect.any(Number),
      threadId: 'ses_1',
      kind: 'runtime_status',
      status: 'busy'
    })
  })

  it('maps MiMo streamed text deltas and ignores idle-only completion signals', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_stream', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_stream',
        part: {
          id: 'part_text',
          messageID: 'msg_assistant',
          sessionID: 'ses_stream',
          type: 'text',
          text: ''
        }
      }
    })).toBeNull()

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_stream', {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_stream',
        messageID: 'msg_assistant',
        partID: 'part_text',
        field: 'text',
        delta: '你好'
      }
    })).toMatchObject({
      threadId: 'ses_stream',
      kind: 'assistant_text_delta',
      item: { text: '你好' }
    })

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_stream', {
      type: 'session.idle',
      properties: { sessionID: 'ses_stream' }
    })).toBeNull()
  })

  it('turns MiMo event stream failures into visible Kun turn failures', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const event = mimoWorkAdapterTestInternals.runtimeStreamFailedEvent(
      'ses_stream_failed',
      'terminated token=tp-123456789012345678901234'
    )

    expect(event).toMatchObject({
      threadId: 'ses_stream_failed',
      kind: 'turn_failed',
      code: 'mimo_event_stream_failed',
      severity: 'error'
    })
    expect(String(event.message)).toContain('当前回复没有完成')
    expect(String(event.message)).toContain('<redacted>')
    expect(String(event.message)).not.toContain('tp-123456789012345678901234')
  })

  it('maps MiMo tool parts into visible running and completed tool events', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const running = mimoWorkAdapterTestInternals.mapMimoEvent('ses_tools', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_tools',
        part: {
          id: 'part_tool',
          messageID: 'msg_assistant',
          sessionID: 'ses_tools',
          type: 'tool',
          callID: 'call_skill',
          tool: 'skill',
          state: {
            status: 'running',
            input: { name: 'brainstorming' },
            title: 'Loading skill: brainstorming',
            time: { start: 1_781_606_401_000 }
          }
        }
      }
    })

    expect(running).toMatchObject({
      threadId: 'ses_tools',
      kind: 'tool_call_started',
      item: {
        kind: 'tool_call',
        status: 'running',
        toolName: 'skill',
        callId: 'call_skill',
        summary: 'Loading skill: brainstorming'
      }
    })

    const completed = mimoWorkAdapterTestInternals.mapMimoEvent('ses_tools', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_tools',
        part: {
          id: 'part_tool',
          messageID: 'msg_assistant',
          sessionID: 'ses_tools',
          type: 'tool',
          callID: 'call_skill',
          tool: 'skill',
          state: {
            status: 'completed',
            input: { name: 'brainstorming' },
            output: 'Loaded brainstorming instructions.',
            title: 'Loading skill: brainstorming',
            metadata: {},
            time: { start: 1_781_606_401_000, end: 1_781_606_402_000 }
          }
        }
      }
    })

    expect(completed).toMatchObject({
      threadId: 'ses_tools',
      kind: 'tool_call_finished',
      item: {
        kind: 'tool_result',
        status: 'completed',
        output: { text: 'Loaded brainstorming instructions.' }
      }
    })
  })

  it('synthesizes stale MiMo question tool parts into user input cards', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const event = mimoWorkAdapterTestInternals.mapMimoEvent('ses_questions', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_questions',
        part: {
          id: 'part_question',
          messageID: 'msg_assistant',
          sessionID: 'ses_questions',
          type: 'tool',
          callID: 'call_question',
          tool: 'question',
          state: {
            status: 'running',
            input: {
              questions: [{
                header: 'Confirm',
                question: 'Please confirm the topic.',
                options: []
              }]
            },
            title: 'Question'
          }
        }
      }
    })

    expect(event).toBeNull()

    const staleMessage = {
      info: {
        id: 'msg_assistant',
        role: 'assistant',
        parentID: 'msg_user',
        time: { created: 1_781_606_402_000 }
      },
      parts: [{
        id: 'part_question',
        messageID: 'msg_assistant',
        sessionID: 'ses_questions',
        type: 'tool',
        callID: 'call_question',
        tool: 'question',
        state: {
          status: 'running',
          input: {
            questions: [{
              header: 'Confirm',
              question: 'Please confirm the topic.',
              options: []
            }]
          },
          title: 'Question'
        }
      }]
    }
    const turns = mimoWorkAdapterTestInternals.messagesToTurns(settings(), 'ses_questions', [staleMessage])

    expect(turns[0]?.items).toEqual([
      expect.objectContaining({
        kind: 'user_input',
        status: 'pending',
        inputId: expect.stringMatching(/^synthetic_question_/),
        questions: [expect.objectContaining({
          header: 'Confirm',
          question: 'Please confirm the topic.'
        })]
      })
    ])

    const snapshotEvents = mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents(
      'ses_questions',
      [staleMessage],
      1_781_606_401_000
    )

    expect(snapshotEvents).toEqual([
      expect.objectContaining({
        kind: 'user_input_requested',
        inputId: expect.stringMatching(/^synthetic_question_/),
        questions: [expect.objectContaining({ header: 'Confirm' })]
      })
    ])

    const pendingQuestion = {
      id: 'que_1',
      sessionID: 'ses_questions',
      tool: { callID: 'call_question' },
      questions: [{
        header: 'Confirm',
        question: 'Please confirm the topic.',
        options: []
      }]
    }
    const realQuestionTurns = mimoWorkAdapterTestInternals.messagesToTurns(
      settings(),
      'ses_questions',
      [staleMessage],
      [pendingQuestion]
    )

    expect(realQuestionTurns[0]?.items).toEqual([])
  })

  it('keeps previously answered synthetic question cards submitted after reload', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const assistantQuestion = {
      info: {
        id: 'msg_assistant',
        role: 'assistant',
        parentID: 'msg_user',
        time: { created: 1_781_606_402_000 }
      },
      parts: [{
        id: 'part_question',
        messageID: 'msg_assistant',
        sessionID: 'ses_questions',
        type: 'tool',
        callID: 'call_question',
        tool: 'question',
        state: {
          status: 'running',
          input: {
            questions: [{
              header: 'Confirm',
              question: 'Please confirm the topic.',
              options: []
            }]
          },
          title: 'Question'
        }
      }]
    }
    const submittedFollowup = {
      info: {
        id: 'msg_followup',
        role: 'user',
        time: { created: 1_781_606_403_000 }
      },
      parts: [{
        type: 'text',
        text: '用户已经回答了上一轮未能完成的 question 工具提问。\n请继续。'
      }]
    }

    const turns = mimoWorkAdapterTestInternals.messagesToTurns(settings(), 'ses_questions', [
      {
        info: {
          id: 'msg_user',
          role: 'user',
          time: { created: 1_781_606_401_000 }
        },
        parts: [{ type: 'text', text: 'original prompt' }]
      },
      assistantQuestion,
      submittedFollowup
    ])

    expect(turns[0]?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_input',
        status: 'submitted',
        inputId: expect.stringMatching(/^synthetic_question_/)
      })
    ]))
  })

  it('keeps execution guardrails in synthetic question follow-up prompts', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const prompt = mimoWorkAdapterTestInternals.syntheticQuestionFollowupPrompt([
      {
        id: 'topic',
        header: '论文主题',
        question: '请选择主题'
      }
    ], [
      {
        id: 'topic',
        label: '传染病传播预测'
      }
    ])

    expect(prompt).toContain('MIMO Work execution guardrails:')
    expect(prompt).toContain('empty arguments')
    expect(prompt).toContain('.docx')
    expect(prompt).toContain('请把下面的回答当作该 question 工具的结果继续执行原任务')
    expect(prompt).toContain('回答：传染病传播预测')
  })

  it('hides the Core write tool from the MIMO Work build agent', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const current = settings()
    const mimo = mimoWorkAdapterTestInternals.effectiveMimoCredentials(current)
    const config = await mimoWorkAdapterTestInternals.mimoWorkCoreConfigContent(current, mimo)
    const buildAgent = ((config.agent as Record<string, unknown>).build as Record<string, unknown>)
    const allowlist = buildAgent.tool_allowlist as string[]

    expect(allowlist).toEqual(expect.arrayContaining(['bash', 'read', 'question', 'skill', 'task']))
    expect(allowlist).not.toContain('write')
    expect(buildAgent.tools).toMatchObject({ write: false })
    expect(buildAgent.permission).toMatchObject({ edit: 'deny' })
    expect(config).toMatchObject({
      provider: {
        xiaomi: {
          name: 'MiMo'
        }
      }
    })
  })

  it('requests MiMo-Code turns without the write tool', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')

    expect(mimoWorkAdapterTestInternals.mimoWorkPromptToolOverrides()).toEqual({ write: false })
  })

  it('starts MiMo-Code with a minimal redacted environment', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const env = mimoWorkAdapterTestInternals.mimoCoreChildEnv({
      HOME: '/Users/test',
      PATH: '/usr/bin:/bin',
      LANG: 'zh_CN.UTF-8',
      HTTPS_PROXY: 'http://127.0.0.1:6688',
      DEEPSEEK_API_KEY: 'sk-should-not-leak',
      AUTH_TOKEN: 'should-not-leak',
      CODEX_THREAD_ID: 'should-not-leak',
      XPC_SERVICE_NAME: 'application.com.mimowork.desktop',
      __CFBundleIdentifier: 'com.mimowork.desktop'
    }, {
      MIMOCODE_HOME: '/Users/test/.mimo-work/data/mimocode',
      MIMOCODE_CLIENT: 'desktop',
      MIMOCODE_AUTH_CONTENT: '{"xiaomi":{"key":"tp-secret"}}'
    }, '/Users/test/.mimo-work/data/mimocode/home')

    expect(env).toMatchObject({
      HOME: '/Users/test/.mimo-work/data/mimocode/home',
      PATH: '/usr/bin:/bin',
      LANG: 'zh_CN.UTF-8',
      HTTPS_PROXY: 'http://127.0.0.1:6688',
      XDG_CONFIG_HOME: '/Users/test/.mimo-work/data/mimocode/home/.config',
      XDG_CACHE_HOME: '/Users/test/.mimo-work/data/mimocode/home/.cache',
      XDG_DATA_HOME: '/Users/test/.mimo-work/data/mimocode/home/.local/share',
      MIMOCODE_HOME: '/Users/test/.mimo-work/data/mimocode',
      MIMOCODE_CLIENT: 'desktop',
      MIMOCODE_AUTH_CONTENT: '{"xiaomi":{"key":"tp-secret"}}'
    })
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.AUTH_TOKEN).toBeUndefined()
    expect(env.CODEX_THREAD_ID).toBeUndefined()
    expect(env.XPC_SERVICE_NAME).toBeUndefined()
    expect(env.__CFBundleIdentifier).toBeUndefined()
  })

  it('settles stalled write tool parts so the UI does not stay busy', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const event = mimoWorkAdapterTestInternals.mapMimoEvent('ses_write', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_write',
        part: {
          id: 'part_write',
          messageID: 'msg_assistant',
          sessionID: 'ses_write',
          type: 'tool',
          callID: 'call_write',
          tool: 'write',
          state: {
            status: 'pending',
            input: {}
          }
        }
      }
    })

    expect(event).toMatchObject({
      kind: 'tool_call_finished',
      item: {
        toolName: 'write',
        status: 'failed',
        isError: true,
        output: {
          error: expect.stringContaining('recovered')
        }
      }
    })
  })

  it('settles stale short shell commands so the UI does not wait forever', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const event = mimoWorkAdapterTestInternals.mapMimoEvent('ses_bash', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_bash',
        part: {
          id: 'part_bash',
          messageID: 'msg_assistant',
          sessionID: 'ses_bash',
          type: 'tool',
          callID: 'call_bash',
          tool: 'bash',
          state: {
            status: 'running',
            input: { command: 'mkdir -p /tmp/mimo-work-stale-command' },
            time: { start: Date.now() - 31_000 }
          }
        }
      }
    })

    expect(event).toMatchObject({
      kind: 'tool_call_finished',
      item: {
        toolName: 'bash',
        status: 'failed',
        isError: true,
        output: {
          error: expect.stringContaining('recovered')
        }
      }
    })
  })

  it('does not settle fresh short shell commands before the recovery window', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const event = mimoWorkAdapterTestInternals.mapMimoEvent('ses_bash_fresh', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_bash_fresh',
        part: {
          id: 'part_bash_fresh',
          messageID: 'msg_assistant',
          sessionID: 'ses_bash_fresh',
          type: 'tool',
          callID: 'call_bash_fresh',
          tool: 'bash',
          state: {
            status: 'running',
            input: { command: 'mkdir -p /tmp/mimo-work-fresh-command' },
            time: { start: Date.now() - 1_000 }
          }
        }
      }
    })

    expect(event).toMatchObject({
      kind: 'tool_call_started',
      item: {
        toolName: 'bash',
        status: 'running'
      }
    })
  })

  it('uses a focused recovery prompt for stalled write tool calls', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    const prompt = mimoWorkAdapterTestInternals.stalledWriteRecoveryPrompt()

    expect(prompt).toContain('Core runtime tool stalled')
    expect(prompt).toContain('不要再调用 write 工具')
    expect(prompt).toContain('bash/python/node')
    expect(prompt).toContain('继续原任务')
  })

  it('accepts MiMo events whose session id is carried on the top-level event', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    const event = mimoWorkAdapterTestInternals.mapMimoEvent('ses_legacy_event', {
      type: 'message.part.updated',
      sessionID: 'ses_legacy_event',
      part: {
        id: 'part_text',
        messageID: 'msg_assistant',
        type: 'text',
        text: '实时回复'
      }
    })

    expect(event).toMatchObject({
      threadId: 'ses_legacy_event',
      kind: 'assistant_text_delta',
      item: { text: '实时回复' }
    })
  })

  it('emits missing text from a full MiMo part snapshot without duplicating prior deltas', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_snapshot', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_snapshot',
        part: {
          id: 'part_text',
          messageID: 'msg_assistant',
          sessionID: 'ses_snapshot',
          type: 'text',
          text: '你好'
        }
      }
    })).toMatchObject({
      kind: 'assistant_text_delta',
      item: { text: '你好' }
    })

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_snapshot', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_snapshot',
        part: {
          id: 'part_text',
          messageID: 'msg_assistant',
          sessionID: 'ses_snapshot',
          type: 'text',
          text: '你好'
        }
      }
    })).toBeNull()
  })

  it('does not map user message part updates as assistant deltas', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()

    mimoWorkAdapterTestInternals.mapMimoEvent('ses_roles', {
      type: 'message.updated',
      properties: {
        sessionID: 'ses_roles',
        info: { id: 'msg_user', role: 'user' }
      }
    })

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_roles', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_roles',
        part: {
          id: 'part_user_text',
          messageID: 'msg_user',
          sessionID: 'ses_roles',
          type: 'text',
          text: 'MIMO Work runtime context / 本轮执行上下文:\n[Current user request]\n只回复 OK'
        }
      }
    })).toBeNull()

    mimoWorkAdapterTestInternals.mapMimoEvent('ses_roles', {
      type: 'message.updated',
      properties: {
        sessionID: 'ses_roles',
        info: { id: 'msg_assistant', role: 'assistant' }
      }
    })

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_roles', {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_roles',
        part: {
          id: 'part_assistant_text',
          messageID: 'msg_assistant',
          sessionID: 'ses_roles',
          type: 'text',
          text: 'OK'
        }
      }
    })).toMatchObject({
      kind: 'assistant_text_delta',
      item: { text: 'OK' }
    })
  })

  it('falls back to completed MiMo message snapshots when the live event stream is silent', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()
    const sinceMs = 1_781_606_400_000

    const events = mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_snapshot_fallback', [
      {
        info: {
          id: 'msg_old',
          role: 'assistant',
          time: { created: sinceMs - 10_000, completed: sinceMs - 9_000 },
          finish: 'stop'
        },
        parts: [{ id: 'part_old_text', type: 'text', text: 'old answer' }]
      },
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: sinceMs + 1_000, completed: sinceMs + 2_000 },
          finish: 'stop'
        },
        parts: [
          { id: 'part_step_start', type: 'step-start' },
          { id: 'part_reasoning', type: 'reasoning', text: '短暂思考' },
          {
            id: 'part_tool',
            messageID: 'msg_assistant',
            type: 'tool',
            callID: 'call_skill',
            tool: 'skill',
            state: {
              status: 'running',
              input: { name: 'brainstorming' },
              title: 'Loading skill: brainstorming',
              time: { start: sinceMs + 1_250 }
            }
          },
          { id: 'part_text', type: 'text', text: 'OK' },
          { id: 'part_step_finish', type: 'step-finish', reason: 'stop' }
        ]
      }
    ], sinceMs)

    expect(events.map((event) => event.kind)).toEqual([
      'assistant_reasoning_delta',
      'tool_call_started',
      'assistant_text_delta',
      'turn_completed'
    ])
    expect(events[0]).toMatchObject({ item: { text: '短暂思考' } })
    expect(events[1]).toMatchObject({ item: { toolName: 'skill', summary: 'Loading skill: brainstorming' } })
    expect(events[2]).toMatchObject({ item: { text: 'OK' } })

    expect(mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_snapshot_fallback', [
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: sinceMs + 1_000, completed: sinceMs + 2_000 },
          finish: 'stop'
        },
        parts: [
          { id: 'part_reasoning', type: 'reasoning', text: '短暂思考' },
          { id: 'part_text', type: 'text', text: 'OK' }
        ]
      }
    ], sinceMs)).toEqual([])
  })

  it('does not mark tool-call-only assistant snapshots as completed turns', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()
    const sinceMs = 1_781_606_400_000

    const events = mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_tool_only', [
      {
        info: {
          id: 'msg_tool_only',
          role: 'assistant',
          time: { created: sinceMs + 1_000, completed: sinceMs + 2_000 },
          finish: 'tool-calls'
        },
        parts: [
          { id: 'part_step_start', type: 'step-start' },
          {
            id: 'part_tool',
            messageID: 'msg_tool_only',
            type: 'tool',
            callID: 'call_bash',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'echo ok' },
              title: 'Run command'
            }
          },
          { id: 'part_step_finish', type: 'step-finish', reason: 'tool-calls' }
        ]
      }
    ], sinceMs)

    expect(events.map((event) => event.kind)).toEqual(['tool_call_finished'])
  })

  it('turns assistant message snapshot errors into failed turn events', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()
    const sinceMs = 1_781_606_400_000

    const events = mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_snapshot_error', [
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: sinceMs + 1_000, completed: sinceMs + 1_500 },
          error: {
            name: 'APIError',
            data: {
              message: 'Invalid API Key',
              param: 'Please provide valid API Key',
              statusCode: 401
            }
          }
        },
        parts: []
      }
    ], sinceMs)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'turn_failed',
      code: 'mimo_assistant_error',
      severity: 'error',
      message: expect.stringContaining('Invalid API Key')
    })
    expect(mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_snapshot_error', [
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: sinceMs + 1_000, completed: sinceMs + 1_500 },
          error: { data: { message: 'Invalid API Key' } }
        },
        parts: []
      }
    ], sinceMs)).toHaveLength(0)
  })

  it('does not mark a snapshot turn complete until MiMo marks the assistant message complete', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()
    const sinceMs = 1_781_606_400_000

    const partialEvents = mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_snapshot_partial', [
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: sinceMs + 1_000 }
        },
        parts: [
          { id: 'part_text', type: 'text', text: '还在写' }
        ]
      }
    ], sinceMs)

    expect(partialEvents.map((event) => event.kind)).toEqual(['assistant_text_delta'])

    const completeEvents = mimoWorkAdapterTestInternals.mapMimoMessageSnapshotEvents('ses_snapshot_partial', [
      {
        info: {
          id: 'msg_assistant',
          role: 'assistant',
          time: { created: sinceMs + 1_000, completed: sinceMs + 2_000 },
          finish: 'stop'
        },
        parts: [
          { id: 'part_text', type: 'text', text: '还在写完了' }
        ]
      }
    ], sinceMs)

    expect(completeEvents.map((event) => event.kind)).toEqual([
      'assistant_text_delta',
      'turn_completed'
    ])
    expect(completeEvents[0]).toMatchObject({ item: { text: '完了' } })
  })

  it('maps MiMo permission and question events to Kun interactive events', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_interactive', {
      type: 'permission.asked',
      properties: {
        id: 'per_1',
        sessionID: 'ses_interactive',
        permission: 'edit',
        patterns: ['src/app.ts']
      }
    })).toMatchObject({
      threadId: 'ses_interactive',
      kind: 'approval_requested',
      approvalId: 'per_1',
      summary: 'edit src/app.ts'
    })

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_interactive', {
      type: 'question.asked',
      properties: {
        id: 'que_1',
        sessionID: 'ses_interactive',
        questions: [{
          header: 'Choice',
          question: 'Which path?',
          options: [{ label: 'A', description: 'Use A' }]
        }]
      }
    })).toMatchObject({
      threadId: 'ses_interactive',
      kind: 'user_input_requested',
      inputId: 'que_1',
      questions: [expect.objectContaining({
        header: 'Choice',
        question: 'Which path?'
      })]
    })
  })

  it('maps MiMo todo and goal events to Kun state events', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_state', {
      type: 'todo.updated',
      properties: {
        sessionID: 'ses_state',
        todos: [{ content: 'Wire adapter', status: 'in_progress' }]
      }
    })).toMatchObject({
      threadId: 'ses_state',
      kind: 'todos_updated',
      todos: {
        threadId: 'ses_state',
        items: [expect.objectContaining({
          content: 'Wire adapter',
          status: 'in_progress'
        })]
      }
    })

    expect(mimoWorkAdapterTestInternals.mapMimoEvent('ses_state', {
      type: 'session.goal',
      properties: {
        sessionID: 'ses_state',
        goal: { condition: 'Finish phase one' }
      }
    })).toMatchObject({
      threadId: 'ses_state',
      kind: 'goal_updated',
      goal: expect.objectContaining({
        threadId: 'ses_state',
        objective: 'Finish phase one',
        status: 'active'
      })
    })
  })

  it('translates Kun review targets into MiMo review prompts', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')

    expect(mimoWorkAdapterTestInternals.reviewPrompt({ kind: 'uncommittedChanges' })).toBe('/review')
    expect(mimoWorkAdapterTestInternals.reviewPrompt({ kind: 'baseBranch', branch: 'main' })).toBe('/review base main')
    expect(mimoWorkAdapterTestInternals.reviewPrompt({ kind: 'commit', sha: 'abc123' })).toBe('/review commit abc123')
    expect(mimoWorkAdapterTestInternals.reviewPrompt({ kind: 'custom', instructions: 'focus on auth' })).toBe('/review focus on auth')
  })

  it('builds MiMo prompt parts from local memory and uploaded attachments', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    mimoWorkAdapterTestInternals.resetLocalAdapterStateForTests()
    const attachment = await mimoWorkAdapterTestInternals.createLocalAttachment(settings(), {
      name: 'sample.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('hello').toString('base64'),
      threadId: 'ses_1'
    })
    await mimoWorkAdapterTestInternals.createLocalMemory({
      content: 'Prefer concise replies',
      scope: 'user'
    })

    expect(attachment).not.toBeNull()
    const parts = mimoWorkAdapterTestInternals.buildPromptParts(
      { attachmentIds: attachment ? [attachment.id] : [] },
      'Describe this'
    )

    expect(parts).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Prefer concise replies') }),
      { type: 'text', text: 'Describe this' },
      expect.objectContaining({
        id: attachment?.id,
        type: 'file',
        mime: 'image/png',
        filename: 'sample.png',
        url: expect.stringMatching(/^data:image\/png;base64,/)
      })
    ])
  })

  it('advertises adapter-backed memory and attachment capabilities', async () => {
    const { mimoWorkAdapterTestInternals } = await import('./mimo-work-adapter')
    expect(mimoWorkAdapterTestInternals.runtimeCapabilities('mimo-v2.5-pro')).toMatchObject({
      attachments: { status: 'available', enabled: true, available: true },
      memory: { status: 'available', enabled: true, available: true }
    })
  })
})
