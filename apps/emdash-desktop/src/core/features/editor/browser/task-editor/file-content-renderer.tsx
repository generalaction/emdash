import { observer } from 'mobx-react-lite';
import { ModelStatusOverlay } from '@core/features/editor/api/browser/monaco/model-status-overlay';
import { buildMonacoModelPath } from '@core/features/editor/api/browser/monaco/monacoModelPath';
import { useModelStatus } from '@core/features/editor/api/browser/monaco/use-model';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import { useEditorContext } from './editor-provider';
import { activeFileEntry as getActiveFileEntry } from './pane-selectors';

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
  const { editorView } = useTaskComposition();
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
