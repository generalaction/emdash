import { observer } from 'mobx-react-lite';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
  TabContentProps,
} from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { TaskTabContext } from '../stores/task-tab-context';
import { EditorProvider } from './editor-provider';
import { FileContentPreview } from './file-content-preview';
import { FileContentRenderer } from './file-content-renderer';
import { FileContentToolbar } from './file-content-toolbar';
import { FILE_CONTENT_TYPES } from './file-content-types';
import { FileTabBarItem, FileTabBarItemDragPreview } from './file-tab-item';
import { getFileModelManager } from './stores/file-model-manager';
import type { FilePayload } from './stores/file-tab-resource';
import { FileTabResource } from './stores/file-tab-resource';

export interface FileOpenArgs {
  path: string;
  /** When true, file is read-only from outside the workspace. */
  external?: boolean;
}

/**
 * Mounts EditorProvider unconditionally so the Monaco instance persists across
 * tab switches. The Monaco host is overlaid and visibility-toggled rather than
 * unmounted, so cursor position and scroll survive kind transitions.
 */
const FileTabContent = observer(function FileTabContent({ host, ctx }: TabContentProps) {
  return (
    <EditorProvider>
      <FileContent host={host} ctx={ctx} />
    </EditorProvider>
  );
});

/** Renders the Monaco source and/or preview for the currently active file tab. */
const FileContent = observer(function FileContent({ host, ctx: _ctx }: TabContentProps) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeFile = activeTab?.kind === 'file' ? (activeTab.resource as FileTabResource) : null;

  const def = activeFile ? FILE_CONTENT_TYPES[activeFile.contentType] : null;
  const showSource = def
    ? def.editable && (activeFile!.viewMode === 'source' || !def.Preview)
    : false;
  const showPreview = def
    ? !!def.Preview && (activeFile!.viewMode === 'preview' || !def.editable)
    : false;
  const canToggle = def ? def.editable && !!def.Preview : false;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {activeFile && <FileContentToolbar tab={activeFile} canToggle={canToggle} />}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0" style={{ visibility: showSource ? 'visible' : 'hidden' }}>
          <FileContentRenderer />
        </div>
        {activeFile && showPreview && (
          <div className="absolute inset-0">
            <FileContentPreview tab={activeFile} />
          </div>
        )}
      </div>
    </div>
  );
});

export const fileTabProvider: TabProvider<'file', FilePayload, FileTabResource, FileOpenArgs> =
  createTabProvider({
    kind: 'file',
    resourceKey: (s: FilePayload) => s.path,

    onBeforeOpen: (args: FileOpenArgs): FilePayload | null => {
      return { path: args.path, isExternal: args.external };
    },

    initialize(
      entry: TabEntry<FilePayload>,
      handle: TabHandle,
      ctx: TabViewContext
    ): FileTabResource {
      const taskCtx = ctx as TaskTabContext;
      const modelManager = getFileModelManager(taskCtx.workspaceId, {
        projectId: taskCtx.projectId,
        workspaceId: taskCtx.workspaceId,
        modelRootPath: taskCtx.modelRootPath,
      });
      return new FileTabResource(
        entry.state,
        modelManager,
        {
          projectId: taskCtx.projectId,
          workspaceId: taskCtx.workspaceId,
          modelRootPath: taskCtx.modelRootPath,
        },
        handle
      );
    },

    dispose(_entry: TabEntry<FilePayload>, resource: FileTabResource): void {
      resource.dispose();
    },

    async onBeforeClose(
      entry: TabEntry<FilePayload>,
      resource: FileTabResource,
      ctx: TabViewContext
    ): Promise<boolean> {
      if (entry.state.isExternal) return true;
      const taskCtx = ctx as TaskTabContext;
      const bufferUri = buildMonacoModelPath(taskCtx.modelRootPath, entry.state.path);
      if (!modelRegistry.isDirty(bufferUri)) return true;

      const fileName = entry.state.path.split('/').pop() ?? entry.state.path;
      return new Promise<boolean>((resolve) =>
        showModal('unsavedChangesModal', {
          fileName,
          onSuccess: (result) => {
            if (result === 'save') {
              void modelRegistry.saveFileToDisk(bufferUri).then(() => resolve(true));
            } else {
              resolve(true);
            }
          },
          onClose: () => resolve(false),
        })
      );
    },

    TabBarItem: FileTabBarItem,
    TabBarItemDragPreview: FileTabBarItemDragPreview,
    TabContent: FileTabContent,
  });
