# Markdown Preview in Editor

## Summary

Add rendered markdown preview for `.md` and `.mdx` files in the CodeEditor. Markdown files open in preview mode by default. A toggle button in the file tab switches between preview and raw editor.

## Motivation

Markdown files currently render as plain text in Monaco. Developers reading READMEs, docs, or notes get a better experience seeing rendered output without leaving the editor.

## Architecture

### Component Structure

```
CodeEditor
├── previewMode: Map<string, boolean>  (state, keyed by file path)
├── FileTabs
│   └── toggle button (eye/pencil icon, markdown files only)
│       └── onClick → togglePreview(path)
└── EditorContent
    └── if markdown AND previewMode.get(path) !== false
        → <MarkdownPreview content={file.content} />
        else
        → <Monaco Editor />
```

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/constants/file-explorer.ts` | Add `MARKDOWN_EXTENSIONS` constant |
| `src/renderer/components/FileExplorer/MarkdownPreview.tsx` | New component (~120 lines) |
| `src/renderer/components/FileExplorer/CodeEditor.tsx` | Add `previewMode` state + conditional branch (~15 lines) |
| `src/renderer/components/FileExplorer/FileTabs.tsx` | Add toggle icon button for markdown files (~20 lines) |

### No New Dependencies

All libraries already installed: `react-markdown` v10.1.0, `remark-gfm`, `rehype-raw`, `react-syntax-highlighter`, `lucide-react`.

## MarkdownPreview Component

### Rendering Stack

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeRaw]}
  components={{ /* custom element overrides */ }}
>
  {content}
</ReactMarkdown>
```

### Layout

Full-pane scrollable container. Centered content with max-width (~720px) for readability. Generous padding. Same container pattern as `ImagePreview` (`flex-1 overflow-auto bg-background`).

### Styled Elements (Tailwind, via `components` prop)

- **Headings** (h1-h6): scaled sizes, `text-foreground`, proper margins
- **Paragraphs**: `text-sm text-foreground leading-relaxed`
- **Lists** (ul/ol): indented, proper markers
- **Code blocks**: `react-syntax-highlighter` with theme based on `useTheme().effectiveTheme` (dark: `oneDark`, light: `oneLight`), language detection from fence info
- **Inline code**: `bg-muted rounded px-1 py-0.5 text-sm`
- **Links**: `text-primary underline`, open externally
- **Tables**: bordered, alternating row backgrounds
- **Blockquotes**: left border accent, muted background
- **Images**: `max-w-full` inline
- **Task lists**: checkbox styling
- **Horizontal rules**: `border-border`

### Theme Awareness

Uses CSS variable tokens (`text-foreground`, `bg-muted`) which auto-adapt to light/dark/dark-black. `react-syntax-highlighter` theme selected dynamically via `useTheme()`.

## FileTabs Toggle Button

### Placement

Inside each tab, between filename and close (X) button. Only rendered for markdown files.

### Appearance

- **Icon**: `Eye` in preview mode, `Pencil` in edit mode (from `lucide-react`)
- **Size**: `h-3 w-3` (matches close button)
- **Style**: `text-muted-foreground hover:text-foreground`
- **Tooltip**: `title="Edit source"` / `title="Show preview"`

### Behavior

- Click toggles `previewMode` for that file path
- Does not affect dirty state or trigger save
- Preview always renders latest buffer content (including unsaved edits)

## Edge Cases

- **Auto-save**: Monaco not mounted in preview mode, so no edits and no auto-save triggers. Resumes when switching to edit.
- **Dirty indicator**: Works independently of preview/edit — tracked in `useFileManager`.
- **Default state**: New markdown files open in preview. Non-markdown files unaffected.
- **File close**: Cleans up `previewMode` entry.
- **Large files**: Synchronous parse. Acceptable for typical markdown. Optimize later if needed.
- **External links**: Open in system browser, not in-app.

## Out of Scope

- Side-by-side split view (editor + preview simultaneously)
- Live preview while typing
- Markdown-specific editor toolbar (bold/italic buttons)
- Custom CSS theme for markdown preview
- Mermaid diagram rendering
