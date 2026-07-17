import { observer } from 'mobx-react-lite';
import { useEditorContext } from '@core/features/tasks/browser/editor/editor-provider';
import { activeFileEntry as getActiveFileEntry } from '@core/features/tasks/browser/editor/pane-selectors';
import { useWorkspaceViewModel } from '@core/features/tasks/browser/task-view-context';
import { usePaneContext } from '@core/features/workbench/browser/tabs/pane-context';
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
