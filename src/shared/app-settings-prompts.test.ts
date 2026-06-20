import { describe, expect, it } from 'vitest'
import {
  buildCodeRuntimePrompt,
  CODE_CURRENT_USER_REQUEST_HEADING,
  CODE_MANAGED_INSTRUCTIONS_HEADING,
  CODE_MIMO_WORK_EXECUTION_GUARDRAILS
} from './app-settings-prompts'

describe('app settings prompts', () => {
  it('injects MIMO Work execution guardrails for code prompts without a custom prefix', () => {
    const prompt = buildCodeRuntimePrompt({ codePromptPrefix: '' }, 'Create a Word document.')

    expect(prompt).toContain(CODE_MANAGED_INSTRUCTIONS_HEADING)
    expect(prompt).toContain(CODE_MIMO_WORK_EXECUTION_GUARDRAILS)
    expect(prompt).toContain('.docx')
    expect(prompt).toContain('python-docx')
    expect(prompt).toContain('Homebrew')
    expect(prompt).toContain(CODE_CURRENT_USER_REQUEST_HEADING)
    expect(prompt).toContain('Create a Word document.')
  })

  it('preserves the user configured code prompt prefix after the built-in guardrails', () => {
    const prompt = buildCodeRuntimePrompt({ codePromptPrefix: 'Prefer concise answers.' }, 'Run tests.')

    expect(prompt.indexOf(CODE_MIMO_WORK_EXECUTION_GUARDRAILS)).toBeLessThan(
      prompt.indexOf('Prefer concise answers.')
    )
    expect(prompt).toContain('Run tests.')
  })
})
