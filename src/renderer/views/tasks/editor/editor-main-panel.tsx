import { FileCode, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { BinaryRenderer } from '@renderer/core/editor/binary-renderer';
import { ImageRenderer } from '@renderer/core/editor/image-renderer';
import { MarkdownEditorRenderer } from '@renderer/core/editor/markdown-renderer';
import { SvgRenderer } from '@renderer/core/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/core/editor/too-large-renderer';
import type { ManagedFile } from '@renderer/core/editor/types';
import { EditorViewStore } from '@renderer/core/stores/editor-view-store';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { FileTabs } from '@renderer/views/tasks/editor/file-tabs';
import { useRequireProvisionedTask } from '@renderer/views/tasks/task-view-context';
import { useEditorContext } from './editor-provider';

export const EditorMainPanel = observer(function EditorMainPanel() {
  const { setEditorHost } = useEditorContext();

  const editorView = useRequireProvisionedTask().editorView;
  useTabShortcuts(editorView);
  const tabs = editorView.tabs;
  const activeTab = editorView.activeTab;

  const isMonacoActive =
    activeTab &&
    (activeTab.renderer.kind === 'text' ||
      activeTab.renderer.kind === 'markdown-source' ||
      activeTab.renderer.kind === 'svg-source');

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <FileCode className="h-10 w-10 opacity-20" />
        <div className="text-center">
          <p className="text-sm font-medium opacity-50">No file open</p>
          <p className="mt-1 text-xs opacity-35">Select a file from the tree to open it here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FileTabs
        tabs={tabs}
        activeTabId={editorView.activeTabId}
        onTabClick={(tabId) => editorView.setActiveTab(tabId)}
        onTabClose={(tabId) => editorView.removeTab(tabId)}
        onPinTab={(tabId) => editorView.pinTab(tabId)}
        onReorder={(from, to) => editorView.reorderTabs(from, to)}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Stable Monaco host — always in DOM, shown/hidden by CSS only. Never re-parented. */}
        <div
          ref={setEditorHost}
          className="absolute inset-0"
          style={{ display: isMonacoActive ? 'flex' : 'none' }}
        />
        {/* Floating "View rendered" toggle shown when editing markdown/svg source */}
        {isMonacoActive &&
          activeTab &&
          (activeTab.kind === 'markdown' || activeTab.kind === 'svg') && (
            <SourceToggleOverlay
              filePath={activeTab.path}
              kind={activeTab.kind}
              editorView={editorView}
            />
          )}
        {/* Non-Monaco renderers */}
        {!isMonacoActive && activeTab && <ActiveNonMonacoRenderer file={activeTab} />}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Floating "View rendered" toggle shown when editing markdown/svg source
// ---------------------------------------------------------------------------

interface SourceToggleOverlayProps {
  filePath: string;
  kind: 'markdown' | 'svg';
  editorView: EditorViewStore;
}

function SourceToggleOverlay({ filePath, kind, editorView }: SourceToggleOverlayProps) {
  const label = kind === 'markdown' ? 'View preview' : 'View rendered';
  const targetKind = kind === 'markdown' ? 'markdown' : 'svg';
  return (
    <button
      className="absolute right-3 top-3 z-10 rounded p-1 bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground"
      onClick={() => editorView.updateRenderer(filePath, () => ({ kind: targetKind }))}
      title={label}
      aria-label={label}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Non-Monaco renderer dispatcher
// ---------------------------------------------------------------------------

interface ActiveNonMonacoRendererProps {
  file: ManagedFile;
}

function ActiveNonMonacoRenderer({ file }: ActiveNonMonacoRendererProps) {
  switch (file.renderer.kind) {
    case 'markdown':
      return <MarkdownEditorRenderer filePath={file.path} />;
    case 'svg':
      return <SvgRenderer filePath={file.path} />;
    case 'image':
      return <ImageRenderer file={file} />;
    case 'too-large':
      return <TooLargeRenderer file={file} />;
    case 'binary':
      return <BinaryRenderer file={file} />;
    default:
      return null;
  }
}
