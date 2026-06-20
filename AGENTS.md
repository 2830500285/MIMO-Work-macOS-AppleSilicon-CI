# MIMO Work Agent Guide

This guide is for AI agents working in this repository. Keep it aligned with
the current product shape before changing runtime, providers, settings, or
packaging.

## Project Facts

- Product name: `MIMO Work`.
- App type: Electron + React + TypeScript desktop app.
- Runtime strategy: the desktop shell talks to MiMo-Code through
  `src/main/runtime/mimo-work-adapter.ts`.
- The old top-level `kun/` runtime is intentionally removed. Do not restore it.
- `Before/` is reference-only upstream material and must not be modified.
- The packaged macOS app should bundle the MiMo-Code `mimo` executable, not the
  old Kun runtime source tree.
- Internal names such as `window.kunGui`, `agents.kun`,
  `src/main/runtime/kun-adapter.ts`, and `src/renderer/src/agent/kun-*` are
  compatibility ABI names unless they explicitly launch or package old runtime
  code.

## Provider Policy

- User-facing providers should be limited to MIMO/Xiaomi and custom APIs.
- MIMO supports recharge mode and Token Plan mode.
- Do not add removed third-party provider presets back.
- Treat API keys as secrets: never hard-code them, log them, commit them, or put
  them in snapshots.
- Token Plan keys may be recognized by the `tp-` prefix only for validation or
  hints.
- Do not configure Git, npm, Bun, or system proxy settings globally. If a proxy
  is needed, scope it to the single command.

## Important Paths

- Renderer UI: `src/renderer/src`
- Main process and IPC: `src/main`
- Shared settings/contracts: `src/shared`
- MiMo runtime adapter: `src/main/runtime/mimo-work-adapter.ts`
- Compatibility adapter entry: `src/main/runtime/kun-adapter.ts`
- MiMo-Code work copy: `../MIMO-Work-Core`
- Reference upstreams: `../Before`

## Runtime And API Notes

- Keep direct local chat available without requiring an IM channel first.
- The shell should continue to expose Kun-style `/v1/*` compatibility routes to
  the renderer while the adapter maps them to MiMo-Code session, event,
  permission, and question APIs.
- Local runtime services should listen on `127.0.0.1` and use a random
  token/password.
- Settings should prefer MiMo-Code concepts and MIMO provider configuration.
- If MiMo-Code lacks a stable REST capability needed by the shell, add the
  smallest compatible API in `MIMO-Work-Core`.

## Coding Rules

- Make surgical changes that directly support the requested behavior.
- Prefer existing project patterns and shared schemas over ad hoc string
  handling.
- Avoid speculative abstractions.
- Do not reformat unrelated files.
- Remove only dead code made obsolete by this work unless the user asks for
  broader cleanup.
- Keep new content ASCII unless user-facing Chinese text or surrounding files
  require otherwise.

## Validation

- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Unit tests: `npm run test`
- macOS directory package smoke:
  `npx --yes electron-builder@26.8.1 --config electron-builder.config.cjs --publish never --mac --x64 --dir`
- Packaging checks should confirm that `dist/mac/MIMO Work.app` contains the
  MiMo-Code `mimo` binary and does not contain the old top-level `kun/` runtime.
- For source/resource cleanup, scan for old product/provider names while
  excluding generated dependency directories such as `node_modules`.

## Git Hygiene

- Check `git status --short --branch` before committing.
- Use branches with the `codex/` prefix unless the user asks otherwise.
- Do not commit build artifacts, extracted apps, temporary logs, local auth
  files, or API keys.
- If unrelated user changes are present, work with them and do not revert them.
