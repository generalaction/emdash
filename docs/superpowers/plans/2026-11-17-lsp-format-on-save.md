# LSP Formatting and Format-on-Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route LSP `textDocument/formatting` to Monaco and format Dart/Go/Rust buffers before save.

**Architecture:** Extend the existing query path (core `LanguageServerSession.query` → `LspRuntime`
→ core `lspContract` → desktop `editorLspContract`/`lsp-controller` → `LanguageServiceClient` →
`MonacoLanguageServices`) with one `formatting` request, register a Monaco
`DocumentFormattingEditProvider`, and run `editor.action.formatDocument` in
`EditorViewStore.saveFile` for format-on-save languages.

**Tech Stack:** TypeScript, zod, @emdash/wire, Monaco, MobX, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-lsp-format-on-save-design.md`

## Global Constraints

- Format-on-save languages: `['dart', 'go', 'rust']`.
- No LSP formatting provider for: typescript, typescriptreact, javascript, javascriptreact, json, jsonc, css, scss, less, html.
- Format-on-save timeout: 3000 ms; on timeout or error, save the unformatted buffer.
- Formatting options: `{ tabSize: model.getOptions().tabSize, insertSpaces: model.getOptions().insertSpaces }`.

## Review Focus

1. Server without `documentFormattingProvider` — format returns `[]`, save proceeds.
2. Language server hangs — save still happens after 3 s.
3. Document version changes while formatting (user types) — stale result discarded, no edits applied.
4. File not shown in any editor at save time — saved without formatting, no error.
5. TS file saved — never formatted.

---

### Task 1: Core formatting request

**Files:**
- Modify: `packages/core/src/runtimes/lsp/api/schemas.ts` (add `lspTextEditSchema`, `lspFormattingQuerySchema`, capability `formatting`)
- Modify: `packages/core/src/runtimes/lsp/api/contract.ts` (add `formatting`)
- Modify: `packages/core/src/runtimes/lsp/node/server-session.ts` (generalize `query` params; client capability `formatting`)
- Modify: `packages/core/src/runtimes/lsp/node/protocol-values.ts` (`formatting` capability projection, `parseTextEdits`)
- Modify: `packages/core/src/runtimes/lsp/node/runtime.ts`, `controller.ts`
- Test: `packages/core/src/runtimes/lsp/node/protocol-values.test.ts`, `runtime.test.ts`

**Interfaces:**
- Produces: `formatting(input: { session, path, version, options: { tabSize: number; insertSpaces: boolean } }) → Result<{ range: LspRange; newText: string }[], LspError>`

- [ ] Test `parseTextEdits` (null → `[]`, edits parsed) and runtime `formatting` returning `[]` when the server lacks `documentFormattingProvider`.
- [ ] Implement; run `vitest run src/runtimes/lsp` in `packages/core`; PASS.

### Task 2: Desktop Wire path

**Files:**
- Modify: `apps/emdash-desktop/src/core/features/editor/api/lsp-contract.ts`, `node/lsp-controller.ts`
- Modify: `apps/emdash-desktop/src/core/features/editor/api/browser/lsp/language-service-client.ts` (binding `formatting(options, signal)`)

**Interfaces:**
- Produces: binding method `formatting(options, signal?) → Promise<LspTextEdit[] | null>`

- [ ] Typecheck app; existing language-service tests pass.

### Task 3: Monaco provider + format-on-save

**Files:**
- Modify: `apps/emdash-desktop/src/core/features/editor/browser/lsp/monaco-language-services.ts` (register provider for LSP languages minus Monaco-formatted ones)
- Modify: `apps/emdash-desktop/src/core/features/editor/api/browser/task-editor/stores/editor-view-store.ts` (`saveFile` formats first)
- Test: `monaco-language-services.browser.test.ts`

- [ ] Test: provider maps LSP edits to Monaco ranges; not registered for `typescript`.
- [ ] Implement; run focused tests; typecheck; lint.
