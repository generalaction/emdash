import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { HtmlRenderer } from '@renderer/lib/editor/html-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';
import { MarkdownFileRenderer } from './markdown-file-renderer';
import { MonacoFileRenderer } from './monaco-file-renderer';

interface FileRendererProps {
  tab: FileTabStore;
}

/**
 * Routes a file tab to the correct renderer based on its current renderer kind.
 *
 * Monaco and Markdown preview are kept alive via Activity so their editor state
 * (cursor position, scroll) survives renderer-kind transitions within the same
 * tab (e.g. toggling svg-source ↔ svg). Binary/preview renderers hold no
 * persistent state and can mount/unmount freely.
 */
export const FileRenderer = observer(function FileRenderer({ tab }: FileRendererProps) {
  const kind = tab.renderer.kind;

  const monacoActive =
    kind === 'text' ||
    kind === 'svg-source' ||
    kind === 'html-source' ||
    kind === 'markdown-source';
  const markdownActive = kind === 'markdown';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Activity mode={monacoActive ? 'visible' : 'hidden'}>
        <MonacoFileRenderer />
      </Activity>
      <Activity mode={markdownActive ? 'visible' : 'hidden'}>
        <MarkdownFileRenderer tab={tab} />
      </Activity>
      {!monacoActive && !markdownActive && <BinaryOrPreviewRenderer tab={tab} />}
    </div>
  );
});

/** Renders file types that carry no persistent editor state. */
function BinaryOrPreviewRenderer({ tab }: FileRendererProps) {
  switch (tab.renderer.kind) {
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
