# LSP document formatting and format-on-save

## Intent

Saving a Dart file in the Emdash editor should leave it formatted the way `dart format` would,
like VS Code with "format on save". Today Emdash wires hover, go-to-definition, references and
diagnostics from host language servers, but not formatting (`packages/core/src/runtimes/lsp/README.md`:
"host-backed LSP completion, formatting and workspace edits are not implemented"). Dart files
therefore save exactly as typed and "Format Document" does nothing for them.

## Goals

- `textDocument/formatting` from the host language server is reachable from the editor: core
  runtime, desktop Wire contract and controller, browser language-service client, Monaco provider.
- "Format Document" (Shift+Alt+F / context menu) works for every LSP language Monaco cannot
  already format and whose server advertises `documentFormattingProvider`.
- Saving a file in a format-on-save language formats the buffer first, as one undoable edit, then
  writes it.

## Non-goals

- Range formatting, on-type formatting, code actions, organize imports.
- A settings UI for format-on-save. The language list is a constant.
- Formatting files that are dirty but not shown in an editor (Save All of background tabs saves
  them unformatted).

## Anti-goals

- Never rewrite a file with a formatter its project does not use. TS/JS/JSON/CSS/HTML projects
  use prettier/oxfmt/etc., which neither Monaco's built-in formatter nor typescript-language-server
  follow, so they are not formatted on save.
- A slow or failing language server must never block or lose a save: formatting has a timeout and
  any failure saves the unformatted buffer.

## Decisions

- Format-on-save languages: `dart`, `go`, `rust` (single canonical formatter each).
- The LSP formatting provider is registered only for LSP languages Monaco has no built-in formatter
  for (everything in the server catalog except typescript, typescriptreact, javascript,
  javascriptreact, json, jsonc, css, scss, less, html). Monaco keeps its own formatters there.
- Formatting options come from the Monaco model (`tabSize`, `insertSpaces`).
- Format-on-save runs `editor.action.formatDocument` on the visible editor holding the file's
  buffer, bounded by a 3 s timeout, then saves. Edits go through Monaco, so Cmd+Z undoes them.
- New LSP error/edge: a server without `documentFormattingProvider` returns no edits.

## Left to the builder

- Exact helper names; test layout following each package's existing tests.
