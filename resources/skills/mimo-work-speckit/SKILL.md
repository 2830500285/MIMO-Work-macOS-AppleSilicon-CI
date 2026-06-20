---
name: mimo-work-speckit
description: Spec-driven workflow for turning MIMO Work requirements into spec, plan, tasks, implementation, and verification.
---

# MIMO Work Speckit

Use this skill when a task is large enough to need a written specification, phased implementation, or acceptance criteria.

## Workflow

1. Specify: capture the user story, scope, assumptions, non-goals, and acceptance criteria.
2. Plan: identify affected modules, interfaces, data flow, risks, and verification.
3. Tasks: split work into ordered, independently verifiable tasks.
4. Implement: complete tasks in order, keeping changes scoped.
5. Verify: run tests, type checks, smoke tests, and note any gaps.

## Suggested Artifacts

- `spec.md`: user needs, scenarios, requirements, non-goals.
- `plan.md`: architecture, interfaces, migration, risk, test strategy.
- `tasks.md`: ordered checklist with verification per task.

## MIMO Work Defaults

- Keep the Shell/Core boundary explicit.
- Prefer adapter-layer compatibility before changing Core behavior.
- Treat API keys and provider details as sensitive.
- Include Chinese and English user-facing text when changing UI.

## 中文说明

当需求较大时，先写规格，再写计划和任务列表。实现时按任务逐项完成，并在每一步说明如何验证。
