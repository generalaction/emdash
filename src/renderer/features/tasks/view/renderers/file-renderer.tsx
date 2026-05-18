import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { HtmlRenderer } from '@renderer/lib/editor/html-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';
import { MonacoFileRenderer } from './monaco-file-renderer';

interface FileRendererProps {
  tab: FileTabStore;
}

/**
 * Routes a file tab to the correct renderer based on its current renderer kind.
 *
 * Monaco is kept alive via Activity so cursor position and scroll survive
 * renderer-kind transitions (e.g. toggling svg-source ↔ svg). All preview
 * renderers, including markdown, mount/unmount freely and hold no persistent state.
 */
export const FileRenderer = observer(function FileRenderer({ tab }: FileRendererProps) {
  const kind = tab.renderer.kind;

  const monacoActive =
    kind === 'text' ||
    kind === 'svg-source' ||
    kind === 'html-source' ||
    kind === 'markdown-source';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Activity mode={monacoActive ? 'visible' : 'hidden'}>
        <MonacoFileRenderer />
      </Activity>
      {!monacoActive && <BinaryOrPreviewRenderer tab={tab} />}
    </div>
  );
});

/** Renders file types that carry no persistent editor state. */
function BinaryOrPreviewRenderer({ tab }: FileRendererProps) {
  switch (tab.renderer.kind) {
    case 'markdown':
      return <MarkdownEditorRenderer filePath={tab.path} />;
    case 'svg':
      return <SvgRenderer filePath={tab.path} />;
    case 'html':
      return <HtmlRenderer filePath={tab.path} />;
    case 'image':
      return <ImageRenderer file={tab} />;
    case 'too-large':
      return <TooLargeRenderer file={tab} />;
    case 'binary':
      return <BinaryRenderer file={tab} />;
    case 'file-error':
      return <FileErrorRenderer file={tab} />;
    default:
      return null;
  }
}
