import { observer } from 'mobx-react-lite';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
  TabContentProps,
} from '@core/features/workbench/browser/tabs/core/tab-provider';
import { createTabProvider } from '@core/features/workbench/browser/tabs/core/tab-provider-registry';
import type { TaskTabContext } from '@core/features/workbench/browser/tabs/core/task-tab-context';
import { resolveWorkspacePath } from '@core/features/workspaces/browser/workspace-path';
import { openModal } from '@renderer/lib/modal/api';
import { modelRegistry } from '../monaco/monaco-model-registry';
import { buildMonacoModelPath } from '../monaco/monacoModelPath';
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
    mount: 'single',
    resourceKey: (s: FilePayload) => s.path,

    onBeforeOpen: (args: FileOpenArgs, ctx: TabViewContext): FilePayload | null => {
      const taskCtx = ctx as TaskTabContext;
      return {
        path: args.external ? args.path : resolveWorkspacePath(taskCtx.workspacePath, args.path),
        isExternal: args.external,
      };
    },

    initialize(
      entry: TabEntry<FilePayload>,
      handle: TabHandle,
      ctx: TabViewContext
    ): FileTabResource {
      const taskCtx = ctx as TaskTabContext;
      if (!taskCtx.workspacePath) throw new Error('Local workspace path is unavailable');
      const modelManager = getFileModelManager(taskCtx.workspaceId, {
        projectId: taskCtx.projectId,
        workspaceId: taskCtx.workspaceId,
        workspacePath: taskCtx.workspacePath,
        modelRootPath: taskCtx.modelRootPath,
      });
      return new FileTabResource(
        entry.state,
        modelManager,
        {
          projectId: taskCtx.projectId,
          workspaceId: taskCtx.workspaceId,
          workspacePath: taskCtx.workspacePath,
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
      _resource: FileTabResource,
      ctx: TabViewContext
    ): Promise<boolean> {
      if (entry.state.isExternal) return true;
      const taskCtx = ctx as TaskTabContext;
      const bufferUri = buildMonacoModelPath(taskCtx.modelRootPath, entry.state.path);
      if (!modelRegistry.isDirty(bufferUri)) return true;

      const fileName = entry.state.path.split('/').pop() ?? entry.state.path;
      const unsavedOutcome = await openModal('unsavedChangesModal', { fileName });
      if (!unsavedOutcome.success) return false;
      if (unsavedOutcome.data === 'discard') return true;

      try {
        const saved = await modelRegistry.saveFileToDisk(bufferUri);
        if (saved !== null) return true;
        if (!modelRegistry.hasPendingConflict(bufferUri)) return false;

        const conflictOutcome = await openModal('conflictDialog', {
          filePath: entry.state.path,
        });
        if (!conflictOutcome.success) return false;
        if (conflictOutcome.data) {
          modelRegistry.reloadFromDisk(bufferUri);
          return true;
        }

        const overwritten = await modelRegistry.saveFileToDisk(bufferUri, { overwrite: true });
        return overwritten !== null;
      } catch {
        return false;
      }
    },

    TabBarItem: FileTabBarItem,
    TabBarItemDragPreview: FileTabBarItemDragPreview,
    TabContent: FileTabContent,
  });
