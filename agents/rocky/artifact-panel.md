# Artifact Panel

The Artifact Panel is the right-side panel in the Rocky workspace. It replaces the
diff / code-editor / browser tabs from emdash with a single panel that renders
whatever the AI co-worker produced. It mirrors Claude.ai's artifact panel in concept.

---

## Where It Lives in the Codebase

```
src/renderer/features/artifact-panel/
├── artifact-panel.tsx           — outer panel shell (split layout, collapse, resize)
├── artifact-viewer.tsx          — switches rendering by artifact type
├── artifact-toolbar.tsx         — Preview|Source toggle, version picker, Copy/Download/Share, Accept/Reject
├── artifact-version-store.ts    — MobX store for version history per artifact
├── artifact-types.ts            — ArtifactType enum + per-type metadata
├── renderers/
│   ├── document-renderer.tsx    — Markdown → rich text (react-markdown or similar)
│   ├── table-renderer.tsx       — JSON/CSV → rendered table
│   ├── diagram-renderer.tsx     — Mermaid → SVG (mermaid.js)
│   ├── web-renderer.tsx         — HTML → sandboxed iframe (see security section)
│   ├── code-renderer.tsx        — Syntax-highlighted code (Monaco read-only)
│   ├── image-renderer.tsx       — Image / SVG display
│   └── pdf-renderer.tsx         — PDF viewer (embed + download)
└── hooks/
    ├── use-artifact-panel.ts    — opens/updates the panel from a chat event
    └── use-artifact-versions.ts — version history navigation
```

Register the panel in the task view layout (`src/renderer/features/tasks/view.tsx`).
The panel is not a separate route; it is a resizable right pane inside the workspace view.

---

## Artifact Types

| Type | `ArtifactType` value | MIME / format | Renderer |
|---|---|---|---|
| Document / Markdown | `document` | `text/markdown` | `document-renderer.tsx` |
| Table / spreadsheet | `table` | JSON array-of-objects or CSV | `table-renderer.tsx` |
| Slides / deck | `slides` | HTML-based or PPTX blob | `document-renderer.tsx` (Phase 1); custom in Phase 3 |
| Diagram (Mermaid) | `diagram` | Mermaid DSL string | `diagram-renderer.tsx` |
| Web page / HTML | `web` | `text/html` | `web-renderer.tsx` (sandboxed iframe) |
| Code | `code` | source text + language hint | `code-renderer.tsx` |
| Image / SVG | `image` | data URI or file path | `image-renderer.tsx` |
| PDF / Office | `file` | blob / file path | `pdf-renderer.tsx` |

Shared type definition belongs in `src/shared/core/artifact/types.ts`:

```ts
export type ArtifactType = 'document' | 'table' | 'diagram' | 'web' | 'code' | 'image' | 'file' | 'slides';

export interface Artifact {
  id: string;
  conversationId: string;
  type: ArtifactType;
  title: string;
  content: string;       // string content for text types; file path for binary
  language?: string;     // for code type
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactVersion {
  artifactId: string;
  version: number;
  content: string;
  createdAt: number;
}
```

---

## Panel Layout

```
┌─────────────────── Artifact Panel ───────────────────────┐
│  one-pager.md v3     [Preview | Source]  [↗ New window]  │
│ ───────────────────────────────────────────────────────── │
│                                                           │
│   [rendered content — document / table / diagram / web]  │
│                                                           │
│                                                           │
│ ───────────────────────────────────────────────────────── │
│  ◀ v1  v2  ▶v3  ↺ revert to v2                          │
│  [Accept]  [Reject]  [Edit with co-worker]               │
│  Copy · Download (.md / .xlsx / .html) · Share           │
└───────────────────────────────────────────────────────────┘
```

- **Split layout:** the workspace view has a resizable left (chat) and right (artifact)
  pane, driven by a `PaneSizingContext` (reuse/extend `src/renderer/lib/pty/pane-sizing-context.tsx`)
- **Collapsible:** an X button closes the panel; chat expands to full width; reopens when
  a new artifact arrives or the user clicks an artifact reference in the chat
- **Multiple artifacts per chat:** the toolbar shows a selector listing all artifacts
  produced in the current conversation; clicking one switches the panel

---

## Opening and Updating the Panel

When Rocky Proxy emits an `artifact` event (see `agents/rocky/rocky-proxy.md`), the
renderer's `use-artifact-panel.ts` hook:
1. Stores the artifact in `artifact-version-store.ts`
2. Opens the panel if not already open
3. Switches to the new artifact

When Rocky Proxy emits `artifact_update`, the hook:
1. Appends a new version to the store
2. Updates the panel to show the new content (auto-scroll to latest version)

The user can also open an artifact by clicking a file in the workspace Documents tree —
this opens the file as an `artifact` of the appropriate type.

---

## Preview ↔ Source Toggle

Applicable to: `web`, `code`, `diagram`, `document`.

- **Preview** — the rendered output (default)
- **Source** — raw content in a Monaco editor (read-only unless in edit mode)

```tsx
const [mode, setMode] = useState<'preview' | 'source'>('preview');
```

For `web` artifacts, Source shows the raw HTML string. Preview shows the sandboxed iframe.

---

## Version History

Every artifact update (from Rocky Proxy or from user edits) is stored as a version in
`artifact-version-store.ts` and persisted to SQLite via a new `artifact_versions` table
(add migration with `pnpm run db:generate`).

- Version picker in the toolbar: `◀ v1  v2  ▶v3 (latest)`
- "Revert to vN" replaces current content with the selected version content and creates
  a new version (it does not delete the newer versions)
- Editing an older version branches: prompt the user "This will branch from v2; continue?"

Schema addition (new migration):

```sql
CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(artifact_id, version)
);
```

---

## Accept / Reject

The Accept / Reject buttons appear when the artifact was **produced or last modified by
the AI co-worker** (tracked by a `pendingReview` flag in the store).

- **Accept** — clears the `pendingReview` flag; the artifact is now the canonical version
- **Reject** — rolls back to the previous version (or deletes the artifact if it is the
  first version) and inserts a "rejected" message into the chat stream; fires a
  `checkpoint.rollback` event to the main process to undo the associated workspace state

`pendingReview` is set to `true` when the artifact arrives from a Rocky Proxy event and
cleared when Accept is pressed or when the user manually edits the artifact.

---

## Edit with Co-worker (highlight-to-edit)

The user highlights text in the document renderer → a floating action appears: "Edit
this with co-worker". Clicking it:
1. Pre-fills the chat composer with the selected text and a system instruction "Edit only
   this section: [selection]"
2. Rocky Proxy returns an `artifact_update` for just that section
3. The diff between old and new is highlighted in the document renderer until Accept/Reject

Implementation: `document-renderer.tsx` listens for `mouseup`, reads
`window.getSelection()`, and renders the floating action positioned at the selection.

---

## Web / HTML Rendering (sandboxed iframe)

**Security requirements (non-negotiable):**

- Render in an `<iframe>` with `sandbox="allow-scripts"` — no allow-same-origin, no
  allow-popups, no allow-forms
- Set `Content-Security-Policy` header (via Electron `webPreferences` or `session` CSP)
  to block all network requests from the iframe: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`
- Use Electron's `<webview>` tag with `nodeintegration=false` and `contextIsolation=true`
  instead of a plain iframe if the iframe sandbox proves insufficient in Electron's
  renderer context
- The existing browser pane (`src/renderer/features/browser/`) uses Electron's webview
  infrastructure. Repurpose or adapt this for the sandboxed web preview.
- **Client-side only:** no server-side code execution, no local file access from inside
  the iframe

Preview ↔ Source toggle: Preview = the sandboxed iframe; Source = raw HTML in Monaco
read-only.

---

## Actions (toolbar)

| Action | Behaviour |
|---|---|
| **Copy** | Copy artifact content to clipboard as Markdown / plain text |
| **Download** | Save to file. Type-appropriate: `.md` for documents, `.html` for web, `.csv`/`.xlsx` for tables, `.svg`/`.png` for diagrams, `.pdf` for file type |
| **Share** | Generate a shareable export (Phase 2: syncs to self-deployed backend; Phase 1: local copy/download) |
| **Open in new window** | Pops the artifact out into a secondary Electron `BrowserWindow` |

---

## What NOT to Build in Phase 1

- In-panel WYSIWYG editing for slides/decks — Phase 3
- Real-time collaborative editing — out of scope v1
- Export to Google Docs/Slides — out of scope v1
- Artifact search across conversations — Phase 3

---

## Relation to Existing Browser Pane

`src/renderer/features/browser/` contains the existing Electron webview-based browser
pane. The `web` artifact renderer can reuse this infrastructure for its sandboxed iframe.
The browser pane also serves as a research tool (web search results) which remains
available as a tool invocation result — not as a top-level tab.
