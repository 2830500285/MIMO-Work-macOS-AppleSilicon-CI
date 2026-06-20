import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Check, Folder, Plus, Trash2, TerminalSquare } from 'lucide-react'
import type { EnvironmentProjectV1 } from '@shared/app-settings'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../lib/workspace-path'
import { SettingsCard, SettingRow } from './settings-controls'

type EnvironmentProjectItem = EnvironmentProjectV1 & {
  isDefault: boolean
  saved: boolean
}

function normalizeProjectPath(path: string): string {
  return normalizeWorkspaceRoot(path).replace(/[\\/]+$/, '')
}

function projectKey(path: string): string {
  return workspaceRootIdentityKey(normalizeProjectPath(path))
}

function upsertProject(
  projects: EnvironmentProjectV1[],
  path: string,
  patch: Partial<EnvironmentProjectV1> = {}
): EnvironmentProjectV1[] {
  const normalized = normalizeProjectPath(path)
  const key = projectKey(normalized)
  if (!key) return projects
  let found = false
  const next = projects.map((project) => {
    if (projectKey(project.path) !== key) return project
    found = true
    return {
      ...project,
      path: normalized,
      ...patch
    }
  })
  if (!found) {
    next.push({
      path: normalized,
      setupCommand: patch.setupCommand ?? ''
    })
  }
  return next
}

function removeProject(projects: EnvironmentProjectV1[], path: string): EnvironmentProjectV1[] {
  const key = projectKey(path)
  return projects.filter((project) => projectKey(project.path) !== key)
}

export function EnvironmentsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update } = ctx
  const environmentProjects: EnvironmentProjectV1[] = form.environmentProjects ?? []
  const defaultWorkspace = normalizeProjectPath(form.workspaceRoot ?? '')
  const [selectedPath, setSelectedPath] = useState('')
  const [pickerError, setPickerError] = useState<string | null>(null)

  const projects = useMemo<EnvironmentProjectItem[]>(() => {
    const map = new Map<string, EnvironmentProjectItem>()
    const add = (project: EnvironmentProjectV1, saved: boolean): void => {
      const path = normalizeProjectPath(project.path)
      const key = projectKey(path)
      if (!key) return
      const existing = map.get(key)
      map.set(key, {
        path,
        setupCommand: project.setupCommand || existing?.setupCommand || '',
        saved: saved || existing?.saved || false,
        isDefault: key === projectKey(defaultWorkspace)
      })
    }
    if (defaultWorkspace) add({ path: defaultWorkspace, setupCommand: '' }, false)
    for (const project of environmentProjects) add(project, true)
    return [...map.values()].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return workspaceLabelFromPath(a.path).localeCompare(workspaceLabelFromPath(b.path))
    })
  }, [defaultWorkspace, environmentProjects])

  const selected =
    projects.find((project) => projectKey(project.path) === projectKey(selectedPath)) ??
    projects[0] ??
    null
  const selectedSaved = selected
    ? environmentProjects.some((project) => projectKey(project.path) === projectKey(selected.path))
    : false

  const addProject = async (): Promise<void> => {
    setPickerError(null)
    try {
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error(t('environmentWorkspacePickerUnavailable'))
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(defaultWorkspace || undefined)
      if (picked.canceled || !picked.path) return
      const path = normalizeProjectPath(picked.path)
      update({ environmentProjects: upsertProject(environmentProjects, path) })
      setSelectedPath(path)
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : String(error))
    }
  }

  const setDefaultProject = (path: string): void => {
    const normalized = normalizeProjectPath(path)
    update({
      workspaceRoot: normalized,
      environmentProjects: upsertProject(environmentProjects, normalized)
    })
    setSelectedPath(normalized)
  }

  const updateSetupCommand = (path: string, setupCommand: string): void => {
    update({
      environmentProjects: upsertProject(environmentProjects, path, { setupCommand })
    })
  }

  const deleteProject = (path: string): void => {
    const next = removeProject(environmentProjects, path)
    update({ environmentProjects: next })
    const remaining = projects.find((project) => projectKey(project.path) !== projectKey(path))
    setSelectedPath(remaining?.path ?? '')
  }

  return (
    <SettingsCard title={t('sectionEnvironments')}>
      <SettingRow
        title={t('environmentsSelectProject')}
        description={t('environmentsDesc')}
        wideControl
        control={
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.95fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] font-medium text-ds-faint">
                  {t('environmentsProjectCount', { count: projects.length })}
                </div>
                <button
                  type="button"
                  onClick={() => void addProject()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('environmentAddProject')}
                </button>
              </div>
              {pickerError ? (
                <div className="rounded-xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
                  {pickerError}
                </div>
              ) : null}
              {projects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ds-border-muted px-4 py-8 text-center text-[13px] text-ds-muted">
                  {t('environmentsEmpty')}
                </div>
              ) : (
                <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
                  {projects.map((project) => {
                    const active = selected && projectKey(selected.path) === projectKey(project.path)
                    return (
                      <button
                        key={project.path}
                        type="button"
                        onClick={() => setSelectedPath(project.path)}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${
                          active
                            ? 'border-accent/40 bg-ds-subtle text-ds-ink shadow-sm'
                            : 'border-ds-border-muted bg-ds-main/40 text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Folder className="h-4 w-4 shrink-0 opacity-75" strokeWidth={1.75} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold">
                              {workspaceLabelFromPath(project.path)}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-ds-faint">
                              {project.path}
                            </span>
                          </span>
                        </span>
                        {project.isDefault ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                            <Check className="h-3 w-3" strokeWidth={1.8} />
                            {t('environmentCurrent')}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="min-w-0 rounded-2xl border border-ds-border-muted bg-ds-main/35 p-4">
              {selected ? (
                <div className="flex min-w-0 flex-col gap-4">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-ds-ink">
                      {workspaceLabelFromPath(selected.path)}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] leading-5 text-ds-faint">
                      {selected.path}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={selected.isDefault}
                      onClick={() => setDefaultProject(selected.path)}
                      className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {t('environmentMakeDefault')}
                    </button>
                    <button
                      type="button"
                      disabled={!selectedSaved}
                      onClick={() => deleteProject(selected.path)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-semibold text-ds-muted shadow-sm transition hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t('environmentRemove')}
                    </button>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                      <TerminalSquare className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
                      {t('environmentSetupCommand')}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-ds-muted">
                      {t('environmentSetupCommandDesc')}
                    </p>
                    <textarea
                      value={selected.setupCommand}
                      onChange={(event) => updateSetupCommand(selected.path, event.target.value)}
                      spellCheck={false}
                      placeholder={t('environmentSetupCommandPlaceholder')}
                      className="mt-3 min-h-28 w-full resize-y rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[12.5px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-56 items-center justify-center text-center text-[13px] text-ds-muted">
                  {t('environmentsEmpty')}
                </div>
              )}
            </div>
          </div>
        }
      />
    </SettingsCard>
  )
}
