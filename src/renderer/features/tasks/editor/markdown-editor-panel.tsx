import { Eye, Pencil } from 'lucide-react';
import { autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type * as monacoNS from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import { useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { registerActiveCodeEditor } from '@renderer/lib/editor/activeCodeEditor';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { codeEditorPool } from '@renderer/lib/monaco/monaco-code-pool';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
} from '@renderer/lib/monaco/monaco-config';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/lib/monaco/monaco-themes';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { useMonacoLease } from '@renderer/lib/monaco/use-monaco-lease';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

/**
 * Handles both markdown preview and markdown source editing.
 * When renderer.kind is 'markdown': shows the rendered preview.
 * When renderer.kind is 'markdown-source': shows a self-contained Monaco editor
 * that owns its own pool lease — separate from the shared persistent Monaco used
 * for plain text/code files.
 */
export const MarkdownEditorPanel = observer(function MarkdownEditorPanel() {
  const { tabManager } = useTabGroupContext();
  const activeTab = tabManager.activeFileEntry;

  if (!activeTab) return null;

  if (activeTab.renderer.kind === 'markdown-source') {
    return <MarkdownSourceEditor key={activeTab.tabId} filePath={activeTab.path} />;
  }

  return <MarkdownEditorRenderer filePath={activeTab.path} />;
});

// ---------------------------------------------------------------------------
// Markdown source editor — owns its own Monaco lease
// ---------------------------------------------------------------------------

interface MarkdownSourceEditorProps {
  filePath: string;
}

const MarkdownSourceEditor = observer(function MarkdownSourceEditor({
  filePath,
}: MarkdownSourceEditorProps) {
  const taskView = useWorkspaceViewModel();
  const { editorView } = taskView;
  const { effectiveTheme } = useTheme();

  const leaseBox = useMonacoLease(codeEditorPool);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  const prevBufUriRef = useRef<string | undefined>(undefined);

  // Theme sync
  useEffect(() => {
    const m = codeEditorPool.getMonaco();
    if (m) defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    codeEditorPool.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme]);

  // Editor setup — fires when the lease arrives
  useEffect(
    () =>
      reaction(
        () => leaseBox.get(),
        (lease) => {
          editorRef.current = lease?.editor ?? null;
          if (!lease) return;

          lease.editor.updateOptions({ glyphMargin: false });
          configureMonacoEditor(lease.editor);

          const cleanupActive = registerActiveCodeEditor(lease.editor);
          lease.disposables.push({ dispose: cleanupActive });

          const monaco = codeEditorPool.getMonaco();
          if (monaco) {
            addMonacoKeyboardShortcuts(lease.editor, monaco as typeof monacoNS, {
              onSave: () => {
                if (filePath) void editorView.saveFile(filePath);
              },
              onSaveAll: () => {
                void editorView.saveAllFiles();
              },
            });
          }

          lease.disposables.push(
            lease.editor.onDidFocusEditorWidget(() => {
              taskView.setFocusedRegion('main');
            })
          );

          if (hostRef.current) {
            hostRef.current.appendChild(lease.container);
            lease.editor.layout();
          }
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Model attachment — re-evaluates when lease, filePath, or modelStatus changes
  useEffect(
    () =>
      autorun(() => {
        const lease = leaseBox.get();
        if (!lease) return;

        const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);
        const status = modelRegistry.modelStatus.get(bufferUri);
        if (status !== 'ready') return;

        modelRegistry.attach(lease.editor, bufferUri, prevBufUriRef.current);
        prevBufUriRef.current = bufferUri;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const setHost = (el: HTMLDivElement | null) => {
    hostRef.current = el;
    const lease = leaseBox.get();
    if (el && lease) {
      el.appendChild(lease.container);
      lease.editor.layout();
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={setHost} className="absolute inset-0" />
      <SourceToggleOverlay filePath={filePath} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Toggle overlay: switches between markdown preview and source
// ---------------------------------------------------------------------------

interface SourceToggleOverlayProps {
  filePath: string;
}

function SourceToggleOverlay({ filePath }: SourceToggleOverlayProps) {
  const { tabManager } = useTabGroupContext();

  return (
    <ToggleGroup
      value={['markdown-source']}
      onValueChange={(value) => {
        if (value.includes('markdown')) {
          tabManager.updateRenderer(filePath, () => ({ kind: 'markdown' }));
        }
      }}
      size="sm"
      className="absolute right-3 top-3 z-10"
    >
      <ToggleGroupItem value="markdown" aria-label="Preview">
        <Eye className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="markdown-source" aria-label="Edit source">
        <Pencil className="h-3.5 w-3.5" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
