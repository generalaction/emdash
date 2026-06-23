import { observer } from 'mobx-react-lite';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { useEditorContext } from '@renderer/features/tasks/editor/editor-provider';
import { activeFileEntry as getActiveFileEntry } from '@renderer/features/tasks/editor/pane-selectors';
import { PreviewSourceToggle } from '@renderer/lib/editor/preview-source-toggle';
import type { FileRendererData } from './stores/file-tab-store';

/**
 * Maps each source-mode renderer kind to its paired preview kind.
 * Adding a new preview/source pair only requires a new entry here.
 */
const SOURCE_TO_PREVIEW = {
  'svg-source': 'svg',
  'html-source': 'html',
  'markdown-source': 'markdown',
} as const satisfies Partial<Record<FileRendererData['kind'], FileRendererData['kind']>>;

/**
 * Renders the sticky Monaco editor host for text, svg-source, html-source, and
 * markdown-source files. Owns the host div wiring (setEditorHost / triggerLayout)
 * and the SourceModeToggleOverlay that switches any source-mode file back to its
 * paired preview renderer.
 *
 * EditorProvider (which creates the Monaco editor instance) lives higher in the tree
 * inside PaneProvider — this component only manages the host attachment point.
 */
export const MonacoFileRenderer = observer(function MonacoFileRenderer() {
  const { setEditorHost } = useEditorContext();

  return (
    <div className="relative h-full w-full">
      <div ref={setEditorHost} className="absolute inset-0 flex" />
      <SourceModeToggleOverlay />
    </div>
  );
});

/**
 * Floating Eye/Pencil toggle shown over Monaco when the active tab is in any
 * source mode (svg-source, html-source, markdown-source). Switches back to the
 * paired preview renderer kind via SOURCE_TO_PREVIEW.
 */
const SourceModeToggleOverlay = observer(function SourceModeToggleOverlay() {
  const { pane } = usePaneContext();
  const activeTab = getActiveFileEntry(pane);
  if (!activeTab) return null;

  const previewKind = SOURCE_TO_PREVIEW[activeTab.renderer.kind as keyof typeof SOURCE_TO_PREVIEW];
  if (!previewKind) return null;

  return (
    <PreviewSourceToggle
      activeMode="source"
      onSwitch={(mode) => {
        if (mode === 'preview') {
          activeTab.updateRenderer(() => ({ kind: previewKind }));
        }
      }}
    />
  );
});
