import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { CsvRenderer } from '@renderer/lib/editor/csv-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { HtmlRenderer } from '@renderer/lib/editor/html-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';
import { rpc } from '@renderer/lib/ipc';
import type { FileTabStore } from './stores/file-tab-store';

interface FileRendererProps {
  tab: FileTabStore;
}

/**
 * Routes a file tab to the correct non-Monaco renderer based on its renderer kind.
 *
 * The Monaco host is hoisted to FileTabBody in file-tab-provider.tsx and is always
 * mounted alongside this component. This component handles external file loading
 * and renders preview/binary renderers; for Monaco-based kinds it returns null
 * (the hoisted host is shown instead via visibility toggling).
 *
 * For external (outside-workspace) tabs, the async file read is triggered here
 * via useEffect so the store's open() and deserialize() remain synchronous.
 */
export const FileRenderer = observer(function FileRenderer({ tab }: FileRendererProps) {
  useEffect(() => {
    if (!tab.isExternal || !tab.isLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await rpc.app.readUserFile(tab.path);
        if (cancelled) return;
        runInAction(() => {
          if (result.success) tab.setExternalContent(result.content);
          else tab.setExternalError(result.error);
        });
      } catch (error) {
        if (cancelled) return;
        runInAction(() => {
          tab.setExternalError(error instanceof Error ? error.message : String(error));
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, tab.isExternal, tab.isLoading, tab.path]);

  return <BinaryOrPreviewRenderer tab={tab} />;
});

/** Renders file types that carry no persistent editor state. */
function BinaryOrPreviewRenderer({ tab }: FileRendererProps) {
  switch (tab.renderer.kind) {
    case 'markdown':
      return <MarkdownEditorRenderer filePath={tab.path} />;
    case 'csv':
      return <CsvRenderer filePath={tab.path} />;
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
