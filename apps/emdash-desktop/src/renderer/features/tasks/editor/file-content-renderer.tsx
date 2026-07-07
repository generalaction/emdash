import { observer } from 'mobx-react-lite';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { useEditorContext } from '@renderer/features/tasks/editor/editor-provider';
import { activeFileEntry as getActiveFileEntry } from '@renderer/features/tasks/editor/pane-selectors';
import { useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { ModelStatusOverlay } from '@renderer/lib/monaco/model-status-overlay';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { useModelStatus } from '@renderer/lib/monaco/use-model';

/**
 * Renders the sticky Monaco editor host for text and source-mode files. Owns the host div
 * wiring (setEditorHost) and model status overlay. The source/preview toggle lives above
 * this component in FileContent so it is never blocked by overlay divs.
 *
 * EditorProvider (which creates the Monaco editor instance) lives higher in the tree inside
 * FileTabContent — this component only manages the host attachment point.
 */
export const FileContentRenderer = observer(function FileContentRenderer() {
  const { setEditorHost } = useEditorContext();
  const { pane } = usePaneContext();
  const { editorView } = useWorkspaceViewModel();
  const activeTab = getActiveFileEntry(pane);
  const bufferUri = activeTab ? buildMonacoModelPath(editorView.modelRootPath, activeTab.path) : '';
  const modelStatus = useModelStatus(bufferUri);

  return (
    <div className="relative h-full w-full">
      <div ref={setEditorHost} className="absolute inset-0 flex" />
      {modelStatus !== 'ready' ? <ModelStatusOverlay status={modelStatus} /> : null}
    </div>
  );
});
