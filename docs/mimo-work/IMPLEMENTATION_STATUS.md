# MIMO Work Implementation Status

## Architecture

MIMO Work uses the Kun Electron shell as the desktop UI and launches MiMo-Code as the local runtime core. The shell keeps the existing Kun renderer boundary (`runtimeRequest` and per-thread SSE), while `src/main/runtime/mimo-work-adapter.ts` exposes Kun-compatible `/v1/*` routes and forwards core operations to MiMo-Code.

## Implemented

- Runtime selection between the legacy Kun runtime and the new `mimo-work` adapter.
- MiMo recharge and Tokenplan credential settings, including Tokenplan region defaults and secret redaction.
- MiMo-Code process launch in development mode from the sibling `MIMO-Work-Core` checkout.
- Packaged-app runtime discovery for bundled MiMo-Code build artifacts, with source/Bun launch as a fallback.
- Thread/session list, create, read, update, archive, delete, fork, interrupt, compact, goal, and todo compatibility routes.
- Turn submission via MiMo-Code `prompt_async` with Kun prompt, memory, and attachment parts mapped into MiMo message parts.
- Per-thread SSE stream synthesized from MiMo-Code global `/event`.
- Approvals mapped to MiMo permission replies, and user inputs mapped to MiMo question replies/rejections.
- Adapter-backed memory and attachment APIs persisted under the local runtime data directory.
- Usage aggregation from MiMo assistant message token/cost metadata for thread, day, and model views.
- Review target mapping to MiMo `/review` prompts, plus diff forwarding to MiMo `/:sessionID/diff`.

## Verification

- Shell TypeScript: `npm run typecheck`
- Shell focused adapter/settings tests: `npm test -- src/main/runtime/mimo-work-adapter.test.ts src/renderer/src/components/settings-section-agents.test.ts src/shared/mimo-credentials.test.ts src/shared/secret-redaction.test.ts src/main/kun-health.test.ts`
- Write, Connect, and schedule tests: `npm test -- src/renderer/src/store/chat-store-thread-actions.test.ts src/main/schedule-runtime.test.ts src/renderer/src/components/chat/ConnectPhoneView.test.ts src/main/provider-connection.test.ts`
- Write inline tests: `ELECTRON_OVERRIDE_DIST_PATH=/tmp/mimo-work-electron-override npm test -- src/main/services/write-inline-completion-service.test.ts src/renderer/src/write/quoted-selection.test.ts src/renderer/src/write/inline-completion/prompt.test.ts`
- Core TypeScript: `bun --cwd packages/opencode typecheck`
- Core serve smoke: start `mimo serve`, read `/session`, and create one local session without sending a model prompt.
- Core packaged runtime smoke: `bun --cwd packages/opencode ./script/build.ts --single --skip-install --skip-embed-web-ui`
- Shell production build: `npm run build`
- macOS directory package smoke: `npx --yes electron-builder@26.8.1 --config electron-builder.config.cjs --publish never --mac --x64 --dir`
- Packaged runtime check: run `dist/mac/MIMO Work.app/Contents/Resources/MIMO-Work-Core/packages/opencode/dist/mimocode-darwin-x64/bin/mimo --version`
- Diff hygiene: `git diff --check` in both shell and core worktrees

## Remaining Release Smoke

- Launch the Electron app against a real MiMo Tokenplan or recharge credential.
- Send a short prompt and verify streamed assistant events, usage, memory injection, attachment upload, approval, and question flows.
- Build signed/notarized release artifacts when Apple credentials are available.

## Secret Handling

Do not commit MiMo recharge keys or Tokenplan keys. Use local environment variables, local auth files, or the app settings store only. Because a real Tokenplan key was shared during development, rotate it after smoke testing.
