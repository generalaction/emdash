# LSP runtime

Buffers use the host LSP runtime for hover, definition, type definition, references
and diagnostics, according to each server's capabilities. `typescript-language-server`
6.0.1 with TypeScript 6.0.3 and Pyright 1.1.414 ship with desktop and workspace-server.
They start only when needed; opening a Python file does not launch the TypeScript
server. Nothing is downloaded
when a file opens. Other servers can be installed or selected in machine dependencies.
Right-click a file tab and choose **Language services…** for status and restart;
there is no persistent language-service indicator in the file header.
The executable runs on the host containing the worktree, including SSH hosts.
Remote language services are included in workspace protocol 12.0.

The LSP worker starts on the first language-service request in both desktop and workspace-server
hosts. Its startup is excluded from required host readiness, so a failed or pending LSP startup does
not block unrelated runtimes. A later request can retry failed startup; concurrent requests share
one attempt, and successful readiness stays cached. Individual language servers still start only
when a session is attached.

| Languages | Server | Host requirements |
| --- | --- | --- |
| TypeScript, JavaScript, JSX, TSX | [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server) with TypeScript 6 | Bundled, runs with Emdash’s Node/Electron; no external Node required |
| Bash, sh | [bash-language-server](https://github.com/bash-lsp/bash-language-server) | Node.js 20+; ShellCheck on PATH adds lint diagnostics |
| Go | [gopls](https://go.dev/gopls/) | Go toolchain; make GOBIN or GOPATH/bin available on PATH after installing |
| Rust | [rust-analyzer](https://rust-analyzer.github.io/book/installation.html) | Rust toolchain, Cargo and rust-src; the offered rustup command installs the analyzer and sources |
| Python | [Pyright](https://github.com/microsoft/pyright) | Bundled, runs with Emdash’s Node/Electron; uses the project’s Python environment |
| C, C++ | [clangd](https://clangd.llvm.org/installation) | Project compiler flags, normally compile_commands.json; Homebrew LLVM's bin directory must be on PATH or selected explicitly |
| JSON, JSONC | [VS Code JSON server](https://github.com/hrsh7th/vscode-langservers-extracted) | Node.js; JSONC includes .jsonc, tsconfig.json and jsconfig.json |
| YAML | [yaml-language-server](https://github.com/redhat-developer/yaml-language-server) | Node.js; schemas may be associated using a file modeline |
| HTML, CSS, SCSS, Less | [VS Code HTML/CSS servers](https://github.com/hrsh7th/vscode-langservers-extracted) | Node.js; HTML, CSS and JSON executables share one npm install package |

Bash selection includes `.sh`, `.bash` and known startup files such as `.bashrc`;
there is no shebang discovery for arbitrary extensionless scripts. Zsh and Fish
do not activate the Bash server. Navigation capabilities vary: for example, schema
languages principally offer hover and validation, not programming-language type
definitions. Monaco retains its existing completion and formatting providers;
host-backed LSP completion, formatting and workspace edits are not implemented.

Hover and navigation select a provider per document and capability. Missing tools,
starting/failed servers, unsupported capabilities and disconnected hosts fall back
to Monaco's bundled services where available (TS/JS, CSS/SCSS/Less, HTML and JSON).
A successful empty host answer is authoritative. Local TypeScript validation keeps
the editor's existing syntax-only policy. There is one diagnostic marker owner per
model: current host publications, including empty ones, supersede local validation;
edits clear stale diagnostics, and loss of the host restores local validation. Late
results cannot replace a newer document or provider's markers. Disk/Git snapshots
retain local services and are never replicated to a host.

Fallback analyzes loaded models and bundled declarations, not the project's filesystem
or full configuration. It restores basic hover, definition/reference navigation and
validation where Monaco supports them; type-definition navigation still requires host
LSP. Rust, Go and other languages without Monaco services still need their host server.
The language-services dialog explains basic support and offers host-server retry.

The Monaco adapter owns provider selection and model lifetimes. Local worker access
and diagnostic arbitration are separate editor modules, with no host or Wire
knowledge. Automatic registrations for overlapping Monaco features are disabled;
the editor invokes the local workers as fallback. TypeScript reuses Monaco's worker;
CSS, HTML and JSON fallback workers start lazily and are released after two minutes
of inactivity. Host availability never changes global language defaults.

[editor/browser/lsp/monaco-language-services.ts](../../../../../apps/emdash-desktop/src/core/features/editor/browser/lsp/monaco-language-services.ts) adapts Monaco models, providers,
diagnostics and navigation. It registers providers once during lazy Monaco bootstrap.
[editor/api/browser/lsp/language-service-client.ts](../../../../../apps/emdash-desktop/src/core/features/editor/api/browser/lsp/language-service-client.ts) owns project discovery, session
sharing, buffer lifetime, cancellation and synchronization before queries. Its document
bindings expose semantic queries without requiring Monaco or session keys. File tabs
register the originating task and workspace root before their buffer models are created. Only `emdash-buffer:` models are
replicated; disk and Git snapshots never enter the language server. Shared model
lifetime owns open/close, so split panes and dirty buffers surviving tab closure
remain consistent. `DocumentSynchronizer` coalesces edits and flushes every open
buffer before a query. Unchanged versions are checked before reading model text.
After the initial snapshot, the synchronizer sends one compact UTF-16 edit against
the last acknowledged version. A mismatched base requests a fresh snapshot;
reconnects also replay snapshots. The host retains complete text for restart and
expands edits only when a server requires full-document synchronization. The shared
file store emits successful saves with the exact text written to disk. That immutable
snapshot crosses Wire with the save notification; the host uses it for didSave's
optional text instead of its newer live overlay. Synchronization can keep newer edits
without rolling the server document back. The store leaves those edits dirty and
recoverable, and isolates synchronous and asynchronous save-observer failures from
the completed write. Results preserve host identity and the originating task when
navigating outside the root.

`LanguageSessionClient` leases typed live state through the editor Wire domain.
Its `attachedClient` promise means the Wire attachment exists; server readiness is
a separate live state. Connection state is separate from authoritative server status.
Individual request failures are reported to the caller without marking the server
as failed or clearing diagnostics. Cancelled and stale queries are discarded. The
Node editor controller routes to `RuntimeBroker`; it does not own processes or
LSP protocol state. `packages/core/src/runtimes/lsp/` owns process framing,
initialization, document versions, cancellation, capabilities, diagnostics and
shutdown. It runs as a worker on both desktop and workspace-server, with one
server per renderer client, resolved project root and server ID. Server commands come
from bundled assets or host dependency descriptors, never renderer-supplied shell text. A live-state
lease keeps the server alive; the last detach releases it after a short grace
period. Explicit restart replays unsaved buffers, and replacement generations
invalidate renderer synchronization caches.

The server registry uses UTF-16 positions and a two-million-character document limit. Adding
another server means adding portable selection metadata in [lsp/api/server-catalog.ts](api/server-catalog.ts)
and a host profile in [lsp/node/server-registry.ts](node/server-registry.ts), then exercising its capability
negotiation and synchronization behavior. The renderer derives provider selectors,
protocol language IDs, session keys and labels from that metadata. Monaco-specific
language mappings remain in the editor adapter; Core contains only protocol language
IDs. Host profiles own executable descriptors, arguments, project-root markers and configuration;
the process transport only binds their supplied request handlers to JSON-RPC.

Project discovery runs through Wire on the file's host before acquiring a session.
For TS/JS, the nearest `tsconfig.json`, `jsconfig.json` or `package.json` between the
file and task workspace selects the root; absent markers and external definition
targets retain the task workspace root. Automatic selection uses the bundled
`typescript-language-server`. The TypeScript profile resolves the project's
`tsserver.js`, including hoisted dependencies, and falls back to the bundled TS6
compiler if the project has no compatible server. Resolution does not execute
project code. Explicit machine-dependency selections override the bundled launch;
invalid selections remain visible as errors. Automatic typing acquisition is
disabled so opening a JavaScript file never starts npm downloads. Go recognizes
`go.mod`/`go.work`; Rust recognizes `Cargo.toml` and
`rust-project.json`; Python recognizes Pyright, pyproject and common Python project
files; C/C++ recognizes compilation databases, `.clangd` and CMake roots. Each uses
the nearest marker inside the task workspace. Bash, JSON, YAML, HTML and CSS use
the task workspace root without borrowing a nearby TypeScript package root.

The Python host profile discovers `.venv`, then `venv`, then a captured `VIRTUAL_ENV`
with an executable interpreter, without running project code during discovery.
Otherwise Pyright discovers Python from the host environment. Pyright continues
to read `pyrightconfig.json` and `pyproject.toml`; diagnostics are limited to open
files. Go and Rust inherit the captured host toolchain environment. The process
transport remains independent of these policies.
Host configuration is resolved again when a server restarts.
`vscode-languageserver-protocol` (MIT) supplies JSON-RPC framing and cancellation.
TypeScript 6.0.3 and `typescript-language-server` 6.0.1 (both Apache-2.0) are pinned
production dependencies, alongside Pyright (MIT). Both servers use the host's
Emdash Node/Electron executable; Electron launches them with `ELECTRON_RUN_AS_NODE`.
The same JavaScript assets work on every supported CPU architecture. Electron
unpacks the servers and their runtime data, with an explicit resource-copy rule
preserving TypeScript's `.d.ts` standard libraries, which its default module
filter would otherwise remove. Workspace-server stages the same pinned versions.
Release validation rejects missing assets or accidental resolution outside the
production deployment. The repository's native-preview compiler remains a
development build tool and is not a bundled language server.

After Electron finishes packaging, native-architecture release builds also launch
both servers using the finished app's executable with an empty PATH and isolated
home. The check follows definitions into the shipped TypeScript declarations and
Pyright stubs and verifies type diagnostics. Cross-compiled apps need the same check
on a matching host via `scripts/release/verify-language-servers.ts --executable <binary>
--resources <resources-directory>`. It does not modify the app or launch its UI.
The dedicated CI packaging job exercises stable and canary Electron packages and
verifies that removing standard-library assets makes the check fail.
The probe reuses the existing MIT-licensed LSP protocol client as a direct desktop
development dependency instead of implementing a second JSON-RPC transport.

Bash, YAML and `vscode-langservers-extracted` remain development-only integration
fixtures. The extracted web-server package brings TypeScript 4.9.5 transitively;
it is not shipped as our TypeScript server or as a production dependency. Monaco
supplies basic HTML/CSS/JSON support without adding that aggregate server package.

The Wire contract names snapshot replacement (`setDocumentSnapshot`), versioned
edits (`applyDocumentEdit`), save notification (`documentSaved`) and process recovery
(`restartServer`) explicitly. Definition, type-definition and reference queries are
separate operations; references preserve the caller's `includeDeclaration` option.
Snapshot replication is required for initialization and recovery, not compatibility.
This unreleased feature is included in protocol 12.0, with no legacy LSP aliases.

Tests cover protocol state and actual server behavior in Core, host routing and
buffer policy in desktop Node tests, and Monaco providers/navigation in browser
tests. [language-services.e2e.browser.test.ts](../../../../../apps/emdash-desktop/src/core/features/editor/browser/lsp/language-services.e2e.browser.test.ts) carries actual Wire frames through
Playwright bindings into the production editor controller and host runtime,
then checks cross-file unsaved types, definitions, diagnostics and restart with
real TypeScript and Python servers. The bindings exist only in Vitest's test harness.
Core's [language-servers.integration.test.ts](node/language-servers.integration.test.ts) additionally checks production host
profiles against real Bash, JSON/JSONC, YAML, HTML, CSS/SCSS/Less servers in ordinary
test runs. Enable its native Go, Rust and C++ cases with installed `gopls`, `go`,
`rust-analyzer`, `cargo`, `rustc` and `clangd` on PATH:

```bash
EMDASH_TEST_NATIVE_LSP=1 pnpm --dir packages/core exec vitest run src/runtimes/lsp/node/language-servers.integration.test.ts
```

This opt-in fails if a requested tool is absent; it does not install tools or silently
skip a broken setup. It covers navigation, type definitions where supported, unsaved
edits, restart replay and lease cleanup. Schema and stylesheet cases also verify
diagnostics arriving and clearing after unsaved edits.
