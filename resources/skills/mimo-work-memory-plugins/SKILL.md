---
name: mimo-work-memory-plugins
description: Built-in memory workflow with optional YantrikDB and Icarus integration guidance for persistent project/user memory.
---

# MIMO Work Memory Plugins

Use this skill when a task asks to remember preferences, recall prior context, search saved knowledge, or configure memory providers.

## Built-In Memory Behavior

- Store only useful, durable facts: user preferences, project decisions, recurring constraints, stable environment details.
- Do not store secrets, API keys, private tokens, or transient debugging noise.
- Prefer workspace-scoped memory for project decisions and user-scoped memory for personal preferences.
- Verify a remembered fact before relying on it for a risky code change.

## Optional YantrikDB Provider

YantrikDB can provide local persistent memory when configured by the user or deployment:

- `YANTRIKDB_MODE`
- `YANTRIKDB_DB_PATH`

If those values are missing, continue with MIMO Work built-in memory and explain that YantrikDB is not configured.

## Optional Icarus Provider

Icarus can provide recall/write/search style memory tools when bundled or configured by the user. Prefer explicit operations:

- recall relevant context before planning.
- write concise, durable memories after verified outcomes.
- search before assuming a prior decision.

If Icarus tools are unavailable, continue with built-in memory and avoid claiming Icarus is active.

## 中文说明

记忆功能默认使用 MIMO Work 内置能力。YantrikDB 和 Icarus 是可选增强；只有在实际配置存在时才使用，不要假装可用。
