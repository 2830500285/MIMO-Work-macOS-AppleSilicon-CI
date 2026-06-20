---
name: mimo-work-guardrails
description: Default MIMO Work engineering guardrails for careful, simple, goal-driven coding.
---

# MIMO Work Guardrails

Use this skill for software engineering tasks, especially when editing code, debugging, planning, or reviewing a change.

## Core Behavior

- Think before coding. State assumptions when they matter. If requirements are ambiguous, surface the tradeoff before changing code.
- Prefer the minimum code that solves the request. Avoid speculative features, one-off abstractions, and broad rewrites.
- Make surgical changes. Touch only files needed for the task and clean up only unused code introduced by the current change.
- Define success criteria and verify them. For fixes, reproduce or cover the bug when practical, then run the narrowest meaningful checks.

## Execution Loop

1. Inspect the relevant code and existing patterns.
2. Make the smallest coherent change.
3. Run focused tests, type checks, or a local smoke test.
4. Report what changed and any remaining risk.

## Chinese Summary

- 先确认假设和边界，再动手。
- 代码尽量简单，不做未要求的扩展。
- 修改范围要小，避免顺手重构无关代码。
- 每个任务都要有可验证的完成标准，并尽量跑测试或 smoke check。
