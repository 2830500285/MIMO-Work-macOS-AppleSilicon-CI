import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnvironmentsSettingsSection } from './settings-section-environments'

const labels: Record<string, string> = {
  sectionEnvironments: 'Environments',
  environmentsSelectProject: 'Select a project',
  environmentsDesc: 'Local environments tell MIMO Work how to prepare workspaces and worktrees for a project.',
  environmentsEmpty: 'No projects yet.',
  environmentAddProject: 'Add project',
  environmentCurrent: 'Default',
  environmentMakeDefault: 'Set as default',
  environmentRemove: 'Remove',
  environmentSetupCommand: 'Setup command',
  environmentSetupCommandDesc: 'Optional setup command.',
  environmentSetupCommandPlaceholder: 'e.g. npm install'
}

function t(key: string, values?: Record<string, unknown>): string {
  if (key === 'environmentsProjectCount') {
    return `${String(values?.count ?? 0)} projects`
  }
  return labels[key] ?? key
}

describe('EnvironmentsSettingsSection', () => {
  it('renders saved environment projects and their setup command', () => {
    const html = renderToStaticMarkup(createElement(EnvironmentsSettingsSection, {
      ctx: {
        t,
        form: {
          workspaceRoot: '/Users/mac/Documents/MIMO Work/MIMO-Work-Shell',
          environmentProjects: [
            {
              path: '/Users/mac/Documents/MIMO Work/MIMO-Work-Shell',
              setupCommand: 'npm install'
            }
          ]
        },
        update: () => undefined
      }
    }))

    expect(html).toContain('Environments')
    expect(html).toContain('Select a project')
    expect(html).toContain('MIMO-Work-Shell')
    expect(html).toContain('/Users/mac/Documents/MIMO Work/MIMO-Work-Shell')
    expect(html).toContain('Default')
    expect(html).toContain('npm install')
    expect(html).toContain('Add project')
  })
})
