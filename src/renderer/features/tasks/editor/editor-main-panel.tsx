import { observer } from 'mobx-react-lite';
import type { FileTabState } from '@renderer/features/tasks/stores/tab-manager-store';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';

/**
 * Renders file types that do not use Monaco: image, svg preview, binary, too-large, file-error.
 * Shown inside Activity(other-file) in main-panel.tsx.
 */
export const EditorMainPanel = observer(function EditorMainPanel() {
  const { taskView } = useProvisionedTask();
  const activeTab = taskView.tabManager.activeFileTab;

  if (!activeTab) return null;

  return (
    <div className="h-full overflow-hidden">
      <OtherFileRenderer file={activeTab} />
    </div>
  );
});

interface OtherFileRendererProps {
  file: FileTabState;
}

function OtherFileRenderer({ file }: OtherFileRendererProps) {
  switch (file.renderer.kind) {
    case 'svg':
      return <SvgRenderer filePath={file.path} />;
    case 'image':
      return <ImageRenderer file={file} />;
    case 'too-large':
      return <TooLargeRenderer file={file} />;
    case 'binary':
      return <BinaryRenderer file={file} />;
    case 'file-error':
      return <FileErrorRenderer file={file} />;
    default:
      return null;
  }
}
