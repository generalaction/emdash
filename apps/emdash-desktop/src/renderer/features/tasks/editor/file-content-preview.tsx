import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { FILE_CONTENT_TYPES } from './file-content-types';
import type { FileTabResource } from './stores/file-tab-resource';

interface FileContentPreviewProps {
  tab: FileTabResource;
}

/**
 * Renders the preview for a file tab by routing on tab.contentType via FILE_CONTENT_TYPES.
 *
 * Also owns the async external-file content load: when an external file is opened,
 * the store starts in an isLoading state and this effect triggers the actual read.
 * This effect lives here (and not in the store) so that open() and deserialize() remain
 * synchronous.
 *
 * Only mounted when the container (FileContent) determines showPreview is true, which
 * means this component's wrapper div never covers Monaco in source mode — fixing the
 * pointer-events bug from the old always-mounted overlay approach.
 */
export const FileContentPreview = observer(function FileContentPreview({
  tab,
}: FileContentPreviewProps) {
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

  const def = FILE_CONTENT_TYPES[tab.contentType];
  if (!def.Preview) return null;
  const { Preview } = def;
  return <Preview tab={tab} />;
});
