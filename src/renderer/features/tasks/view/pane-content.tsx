import { useDroppable } from '@dnd-kit/core';
import { Eye, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, useEffect } from 'react';
import { PreviewSourceToggle } from '@renderer/lib/editor/preview-source-toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { ConversationsPanel } from '../conversations/conversations-panel';
import { DiffView } from '../diff-view/main-panel/diff-view';
import { EditorMainPanel } from '../editor/editor-main-panel';
import { useEditorContext } from '../editor/editor-provider';
import { MarkdownEditorPanel } from '../editor/markdown-editor-panel';
import { useTabGroupContext } from '../tabs/tab-group-context';
import { PaneEmptyState } from './pane-empty-state';
import { TabBar } from './tab-bar';

/** The content for a single pane: tab bar + renderer area. */
export const PaneContent = observer(function PaneContent() {
  const { groupId, tabManager: paneTabManager } = useTabGroupContext();
  const { setNodeRef: setContentDropRef, isOver: isOverContent } = useDroppable({
    id: `pane-content-${groupId}`,
  });
  const { setEditorHost, triggerLayout } = useEditorContext();

  const activeDesc = paneTabManager.activeDescriptor;
  const activeFileEntry = paneTabManager.activeFileEntry;
  const renderer: 'monaco' | 'markdown' | 'diff' | 'agents' | 'other-file' = (() => {
    if (activeDesc?.kind === 'diff') return 'diff';
    if (!activeFileEntry) return 'agents';
    switch (activeFileEntry.renderer.kind) {
      case 'text':
      case 'svg-source':
      case 'html-source':
        return 'monaco';
      case 'markdown':
      case 'markdown-source':
        return 'markdown';
      default:
        return 'other-file';
    }
  })();

  // Re-run Monaco layout whenever the Monaco slot becomes visible.
  useEffect(() => {
    if (renderer === 'monaco') triggerLayout();
  }, [renderer, triggerLayout]);

  if (paneTabManager.resolvedTabs.length === 0) {
    return <PaneEmptyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TabBar />
      <div ref={setContentDropRef} className="relative min-h-0 flex-1">
        {isOverContent && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-foreground/10" />
        )}
        {/*
         * Persistent Monaco host — always in the DOM, never inside an Activity.
         * CSS display controls visibility so Monaco is never measured at 0×0.
         * triggerLayout() is called above whenever this transitions to visible.
         */}
        <div
          ref={setEditorHost}
          className="absolute inset-0"
          style={{ display: renderer === 'monaco' ? 'flex' : 'none' }}
        />
        {renderer === 'monaco' && <SvgSourceToggleOverlay />}
        {renderer === 'monaco' && <HtmlSourceToggleOverlay />}

        <Activity mode={renderer === 'markdown' ? 'visible' : 'hidden'}>
          <MarkdownEditorPanel />
        </Activity>
        <Activity mode={renderer === 'diff' ? 'visible' : 'hidden'}>
          <DiffView />
        </Activity>
        <Activity mode={renderer === 'agents' ? 'visible' : 'hidden'}>
          <ConversationsPanel />
        </Activity>
        <Activity mode={renderer === 'other-file' ? 'visible' : 'hidden'}>
          <EditorMainPanel />
        </Activity>
      </div>
    </div>
  );
});

/**
 * Shown over the Monaco host when the active tab is an SVG file in source mode.
 * Lets the user toggle back to the SVG preview renderer.
 */
const SvgSourceToggleOverlay = observer(function SvgSourceToggleOverlay() {
  const { tabManager } = useTabGroupContext();
  const activeTab = tabManager.activeFileEntry;

  if (!activeTab || activeTab.renderer.kind !== 'svg-source') return null;

  return (
    <ToggleGroup
      value={['svg-source']}
      onValueChange={(value) => {
        if (value.includes('svg')) {
          tabManager.updateRenderer(activeTab.path, () => ({ kind: 'svg' }));
        }
      }}
      size="sm"
      className="absolute right-3 top-3 z-10"
    >
      <ToggleGroupItem value="svg" aria-label="View rendered">
        <Eye className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="svg-source" aria-label="Edit source">
        <Pencil className="h-3.5 w-3.5" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
});

/**
 * Shown over the Monaco host when the active tab is an HTML file in source mode.
 * Lets the user toggle back to the rendered HTML preview.
 */
const HtmlSourceToggleOverlay = observer(function HtmlSourceToggleOverlay() {
  const { tabManager } = useTabGroupContext();
  const activeTab = tabManager.activeFileEntry;

  if (!activeTab || activeTab.renderer.kind !== 'html-source') return null;

  return (
    <PreviewSourceToggle
      activeMode="source"
      onSwitch={(mode) => {
        if (mode === 'preview') {
          tabManager.updateRenderer(activeTab.path, () => ({ kind: 'html' }));
        }
      }}
    />
  );
});
