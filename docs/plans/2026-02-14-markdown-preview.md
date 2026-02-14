# Markdown Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render markdown files in a styled preview by default in the CodeEditor, with a toggle to switch to the raw Monaco editor.

**Architecture:** Add a `MarkdownPreview` component that conditionally renders in place of Monaco when a `.md`/`.mdx` file is active and preview mode is on (default). A per-file preview state lives in `CodeEditor`, and a toggle button in `FileTabs` flips between modes.

**Tech Stack:** React, react-markdown, remark-gfm, rehype-raw, react-syntax-highlighter, Tailwind CSS, lucide-react icons.

**Design doc:** `docs/plans/2026-02-14-markdown-preview-design.md`

---

### Task 1: Add MARKDOWN_EXTENSIONS constant

**Files:**
- Modify: `src/renderer/constants/file-explorer.ts:53` (after `IMAGE_EXTENSIONS`)

**Step 1: Add the constant**

Add after the `IMAGE_EXTENSIONS` line (line 53):

```typescript
// File extensions considered as markdown
export const MARKDOWN_EXTENSIONS = ['md', 'mdx'];
```

**Step 2: Add the helper function**

Add after the new constant:

```typescript
/** Check if a file path points to a markdown file */
export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? MARKDOWN_EXTENSIONS.includes(ext) : false;
}
```

**Step 3: Run type-check**

Run: `pnpm run type-check`
Expected: PASS (no errors related to these additions)

**Step 4: Commit**

```bash
git add src/renderer/constants/file-explorer.ts
git commit -m "feat(editor): add MARKDOWN_EXTENSIONS constant and isMarkdownFile helper"
```

---

### Task 2: Install @types/react-syntax-highlighter

The package `react-syntax-highlighter` is in `package.json` but `@types/react-syntax-highlighter` is missing.

**Step 1: Install the types**

Run: `pnpm add -D @types/react-syntax-highlighter`

**Step 2: Verify**

Run: `pnpm run type-check`
Expected: PASS

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @types/react-syntax-highlighter"
```

---

### Task 3: Create MarkdownPreview component

**Files:**
- Create: `src/renderer/components/FileExplorer/MarkdownPreview.tsx`

**Reference files to understand patterns:**
- `src/renderer/components/skills/SkillDetailModal.tsx:130-185` — existing markdown rendering with `react-markdown` + `remarkGfm` + custom `components`
- `src/renderer/components/FileExplorer/CodeEditor.tsx:386-403` — `ImagePreview` layout pattern (container styling)
- `src/renderer/hooks/useTheme.ts` — `useTheme()` hook for `effectiveTheme`

**Step 1: Create the component file**

Create `src/renderer/components/FileExplorer/MarkdownPreview.tsx`:

```tsx
import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '@/hooks/useTheme';

interface MarkdownPreviewProps {
  content: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  const components = useMemo(
    () => ({
      h1: ({ children }: any) => (
        <h1 className="mb-4 mt-6 border-b border-border pb-2 text-2xl font-semibold text-foreground first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: any) => (
        <h2 className="mb-3 mt-6 border-b border-border pb-2 text-xl font-semibold text-foreground first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: any) => (
        <h3 className="mb-2 mt-4 text-lg font-semibold text-foreground">{children}</h3>
      ),
      h4: ({ children }: any) => (
        <h4 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h4>
      ),
      h5: ({ children }: any) => (
        <h5 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h5>
      ),
      h6: ({ children }: any) => (
        <h6 className="mb-1 mt-3 text-sm font-semibold text-muted-foreground">{children}</h6>
      ),
      p: ({ children }: any) => (
        <p className="mb-3 text-sm leading-relaxed text-foreground">{children}</p>
      ),
      ul: ({ children }: any) => (
        <ul className="mb-3 ml-6 list-disc space-y-1 text-sm text-foreground">{children}</ul>
      ),
      ol: ({ children }: any) => (
        <ol className="mb-3 ml-6 list-decimal space-y-1 text-sm text-foreground">{children}</ol>
      ),
      li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const isBlock = className?.includes('language-');

        if (isBlock) {
          return (
            <SyntaxHighlighter
              style={isDark ? oneDark : oneLight}
              language={language}
              PreTag="div"
              className="!my-0 !rounded-md !text-xs"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          );
        }

        return (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>
        );
      },
      pre: ({ children }: any) => (
        <pre className="mb-3 overflow-x-auto rounded-md border border-border">{children}</pre>
      ),
      a: ({ href, children }: any) => (
        <a
          href={href}
          className="text-primary underline decoration-primary/50 hover:decoration-primary"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ),
      blockquote: ({ children }: any) => (
        <blockquote className="mb-3 border-l-4 border-border bg-muted/30 py-1 pl-4 text-sm italic text-muted-foreground">
          {children}
        </blockquote>
      ),
      table: ({ children }: any) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }: any) => (
        <thead className="border-b border-border bg-muted/30">{children}</thead>
      ),
      th: ({ children }: any) => (
        <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
      ),
      td: ({ children }: any) => (
        <td className="border-t border-border px-3 py-2 text-foreground">{children}</td>
      ),
      hr: () => <hr className="my-6 border-border" />,
      img: ({ src, alt }: any) => (
        <img src={src} alt={alt || ''} className="my-3 max-w-full rounded" />
      ),
      strong: ({ children }: any) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      input: ({ checked, ...props }: any) => (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-2 align-middle"
          {...props}
        />
      ),
    }),
    [isDark]
  );

  return (
    <div className="flex flex-1 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
          {content}
        </Markdown>
      </div>
    </div>
  );
};
```

**Step 2: Run type-check**

Run: `pnpm run type-check`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm run lint`
Expected: PASS (or only pre-existing warnings)

**Step 4: Commit**

```bash
git add src/renderer/components/FileExplorer/MarkdownPreview.tsx
git commit -m "feat(editor): add MarkdownPreview component with GFM and syntax highlighting"
```

---

### Task 4: Wire MarkdownPreview into CodeEditor

**Files:**
- Modify: `src/renderer/components/FileExplorer/CodeEditor.tsx`

**Reference:** Lines 33-60 for state setup, lines 241-256 for `FileTabs`/`EditorContent` usage, lines 341-373 for `EditorContent` conditional rendering.

**Step 1: Add imports**

At the top of `CodeEditor.tsx`, add after the existing imports (line 24):

```typescript
import { isMarkdownFile } from '@/constants/file-explorer';
import { MarkdownPreview } from './MarkdownPreview';
```

**Step 2: Add preview state**

Inside `CodeEditor` function, after line 59 (`const [isResizing, setIsResizing] = useState(false);`), add:

```typescript
// Track which files are in preview mode (markdown files default to true)
const [previewMode, setPreviewMode] = useState<Map<string, boolean>>(new Map());

const isPreviewActive = activeFilePath
  ? (previewMode.get(activeFilePath) ?? isMarkdownFile(activeFilePath))
  : false;

const togglePreview = useCallback((filePath: string) => {
  setPreviewMode((prev) => {
    const next = new Map(prev);
    const current = next.get(filePath) ?? isMarkdownFile(filePath);
    next.set(filePath, !current);
    return next;
  });
}, []);
```

**Step 3: Pass props to FileTabs**

Modify the `<FileTabs>` JSX (lines 243-248) to pass preview props:

```tsx
<FileTabs
  openFiles={openFiles}
  activeFilePath={activeFilePath}
  onTabClick={setActiveFile}
  onTabClose={closeFile}
  previewMode={previewMode}
  onTogglePreview={togglePreview}
/>
```

**Step 4: Pass `isPreviewActive` to EditorContent**

Modify the `<EditorContent>` JSX (lines 250-255) to pass preview state:

```tsx
<EditorContent
  activeFile={activeFile}
  effectiveTheme={effectiveTheme}
  onEditorMount={handleEditorMount}
  onEditorChange={handleEditorChange}
  isPreviewActive={isPreviewActive}
/>
```

**Step 5: Update EditorContentProps and rendering logic**

Update the `EditorContentProps` interface (lines 334-339):

```typescript
interface EditorContentProps {
  activeFile: any;
  effectiveTheme: string;
  onEditorMount: (editor: any, monaco: any) => void;
  onEditorChange: (value: string | undefined) => void;
  isPreviewActive: boolean;
}
```

Update the `EditorContent` component (lines 341-373) to destructure `isPreviewActive` and add the markdown branch BEFORE the Monaco fallback:

```typescript
const EditorContent: React.FC<EditorContentProps> = ({
  activeFile,
  effectiveTheme,
  onEditorMount,
  onEditorChange,
  isPreviewActive,
}) => {
  if (!activeFile) {
    return <NoFileOpen />;
  }

  if (activeFile.content.startsWith('data:image/')) {
    return <ImagePreview file={activeFile} />;
  }

  if (activeFile.content === '[IMAGE_ERROR]') {
    return <ImageError file={activeFile} />;
  }

  if (isPreviewActive) {
    return <MarkdownPreview content={activeFile.content} />;
  }

  return (
    <div className="flex-1">
      <Editor
        height="100%"
        language={getMonacoLanguageId(activeFile.path)}
        value={activeFile.content}
        onChange={onEditorChange}
        beforeMount={defineMonacoThemes}
        onMount={onEditorMount}
        theme={getMonacoTheme(effectiveTheme)}
        options={DEFAULT_EDITOR_OPTIONS}
      />
    </div>
  );
};
```

**Step 6: Clean up previewMode on file close**

The existing `closeFile` from `useFileManager` handles removing the file from `openFiles`. We also need to clean up `previewMode`. Add a wrapper after the `togglePreview` callback:

```typescript
const handleCloseFile = useCallback(
  (filePath: string) => {
    closeFile(filePath);
    setPreviewMode((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  },
  [closeFile]
);
```

Then replace `onTabClose={closeFile}` with `onTabClose={handleCloseFile}` in the JSX (both in `FileTabs`).

**Step 7: Run type-check**

Run: `pnpm run type-check`
Expected: PASS

**Step 8: Commit**

```bash
git add src/renderer/components/FileExplorer/CodeEditor.tsx
git commit -m "feat(editor): wire markdown preview into CodeEditor with per-file toggle state"
```

---

### Task 5: Add toggle button to FileTabs

**Files:**
- Modify: `src/renderer/components/FileExplorer/FileTabs.tsx`

**Reference:** Current file is 83 lines. `FileTab` component at lines 51-81. Close button pattern at lines 72-78.

**Step 1: Update imports**

Change line 2 from:
```typescript
import { X } from 'lucide-react';
```
to:
```typescript
import { X, Eye, Pencil } from 'lucide-react';
```

Add after line 5:
```typescript
import { isMarkdownFile } from '@/constants/file-explorer';
```

**Step 2: Update FileTabsProps**

Add preview props to the `FileTabsProps` interface (lines 7-12):

```typescript
interface FileTabsProps {
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  previewMode: Map<string, boolean>;
  onTogglePreview: (filePath: string) => void;
}
```

**Step 3: Pass props through to FileTab**

Update the destructuring in `FileTabs` to include the new props, and pass them through to `FileTab`. Update the `FileTabs` component (lines 14-41):

```tsx
export const FileTabs: React.FC<FileTabsProps> = ({
  openFiles,
  activeFilePath,
  onTabClick,
  onTabClose,
  previewMode,
  onTogglePreview,
}) => {
  if (openFiles.size === 0) {
    return null;
  }

  return (
    <div className="flex h-8 items-center overflow-x-auto border-b border-border bg-muted/10">
      {Array.from(openFiles.entries()).map(([path, file]) => (
        <FileTab
          key={path}
          path={path}
          file={file}
          isActive={activeFilePath === path}
          isMarkdown={isMarkdownFile(path)}
          isPreview={previewMode.get(path) ?? isMarkdownFile(path)}
          onClick={() => onTabClick(path)}
          onClose={(e) => {
            e.stopPropagation();
            onTabClose(path);
          }}
          onTogglePreview={(e) => {
            e.stopPropagation();
            onTogglePreview(path);
          }}
        />
      ))}
    </div>
  );
};
```

**Step 4: Update FileTab component**

Update `FileTabProps` interface and the component to include the toggle button:

```typescript
interface FileTabProps {
  path: string;
  file: ManagedFile;
  isActive: boolean;
  isMarkdown: boolean;
  isPreview: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onTogglePreview: (e: React.MouseEvent) => void;
}

const FileTab: React.FC<FileTabProps> = ({
  path,
  file,
  isActive,
  isMarkdown,
  isPreview,
  onClick,
  onClose,
  onTogglePreview,
}) => {
  const fileName = path.split('/').pop() || 'Untitled';

  return (
    <div
      className={cn(
        'flex h-full cursor-pointer items-center gap-1.5 border-r border-border px-3 hover:bg-accent/50',
        isActive && 'bg-background'
      )}
      onClick={onClick}
      title={path}
    >
      <span className="flex-shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} isDirectory={false} />
      </span>
      <span className="text-xs">{fileName}</span>
      {file.isDirty && (
        <span className="text-gray-500" title="Unsaved changes">
          ●
        </span>
      )}
      {isMarkdown && (
        <button
          className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onTogglePreview}
          aria-label={isPreview ? 'Edit source' : 'Show preview'}
          title={isPreview ? 'Edit source' : 'Show preview'}
        >
          {isPreview ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      )}
      <button
        className="ml-1 rounded p-0.5 hover:bg-accent"
        onClick={onClose}
        aria-label={`Close ${fileName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};
```

**Step 5: Run type-check and lint**

Run: `pnpm run type-check && pnpm run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer/components/FileExplorer/FileTabs.tsx
git commit -m "feat(editor): add markdown preview toggle button in file tabs"
```

---

### Task 6: Test the feature and write a unit test

**Files:**
- Create: `src/test/renderer/markdownPreview.test.ts`

**Step 1: Write the unit test**

Test the `isMarkdownFile` helper function:

```typescript
import { describe, expect, it } from 'vitest';
import { isMarkdownFile } from '../../renderer/constants/file-explorer';

describe('isMarkdownFile', () => {
  it('returns true for .md files', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('path/to/docs/guide.md')).toBe(true);
  });

  it('returns true for .mdx files', () => {
    expect(isMarkdownFile('component.mdx')).toBe(true);
  });

  it('returns false for non-markdown files', () => {
    expect(isMarkdownFile('index.ts')).toBe(false);
    expect(isMarkdownFile('style.css')).toBe(false);
    expect(isMarkdownFile('image.png')).toBe(false);
  });

  it('returns false for files with no extension', () => {
    expect(isMarkdownFile('Makefile')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isMarkdownFile('README.MD')).toBe(true);
    expect(isMarkdownFile('notes.Md')).toBe(true);
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `pnpm exec vitest run src/test/renderer/markdownPreview.test.ts`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add src/test/renderer/markdownPreview.test.ts
git commit -m "test(editor): add tests for isMarkdownFile helper"
```

---

### Task 7: Final verification

**Step 1: Run full type-check**

Run: `pnpm run type-check`
Expected: PASS

**Step 2: Run full lint**

Run: `pnpm run lint`
Expected: PASS (or only pre-existing warnings)

**Step 3: Run all tests**

Run: `pnpm exec vitest run`
Expected: All tests PASS

**Step 4: Manual verification checklist**

Run the dev server: `pnpm run dev`

Verify:
- [ ] Open a `.md` file in the CodeEditor — renders as styled markdown preview
- [ ] Toggle button (pencil icon) appears in the file tab for `.md` files
- [ ] Clicking pencil switches to Monaco editor with raw markdown
- [ ] Clicking eye switches back to preview
- [ ] Open a `.ts` file — no toggle button, renders in Monaco as usual
- [ ] Open an image file — renders as image preview as usual
- [ ] Code blocks in markdown have syntax highlighting
- [ ] Tables, lists, blockquotes, links render correctly
- [ ] Preview respects light/dark theme
- [ ] Dirty indicator (dot) shows correctly even in preview mode
- [ ] Closing a markdown tab works cleanly
