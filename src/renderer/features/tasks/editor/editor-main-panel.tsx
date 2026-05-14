import { observer } from 'mobx-react-lite';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { HtmlRenderer } from '@renderer/lib/editor/html-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';

/**
 * Renders file types that do not use Monaco: image, svg preview, binary, too-large, file-error.
 * Shown inside Activity(other-file) in main-panel.tsx.
 */
export const EditorMainPanel = observer(function EditorMainPanel() {
  const taskView = useWorkspaceViewModel();
  const activeTab = taskView.tabManager.activeFileEntry;

  if (!activeTab) return null;

  return (
    <div className="h-full overflow-hidden">
      <OtherFileRenderer key={`${activeTab.tabId}:${activeTab.path}`} file={activeTab} />
    </div>
  );
});

interface OtherFileRendererProps {
  file: FileTabStore;
}

function OtherFileRenderer({ file }: OtherFileRendererProps) {
  switch (file.renderer.kind) {
    case 'svg':
      return <SvgRenderer filePath={file.path} />;
    case 'html':
      return <HtmlRenderer filePath={file.path} />;
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
