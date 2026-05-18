import { observer } from 'mobx-react-lite';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';

interface MarkdownFileRendererProps {
  tab: FileTabStore;
}

/**
 * Renders the markdown preview for a markdown file.
 * Source editing (markdown-source) is handled by MonacoFileRenderer via the
 * shared persistent Monaco instance, exactly like svg-source and html-source.
 */
export const MarkdownFileRenderer = observer(function MarkdownFileRenderer({
  tab,
}: MarkdownFileRendererProps) {
  return <MarkdownEditorRenderer filePath={tab.path} />;
});
