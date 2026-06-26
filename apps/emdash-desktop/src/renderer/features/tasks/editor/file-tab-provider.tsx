import { observer } from 'mobx-react-lite';
import type {
  TabProvider,
  TabHost,
  TabViewContext,
  TabContentProps,
  ResolvedTab,
  ResolveContext,
} from '@renderer/features/tabs/core/tab-provider';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { TabDescriptor } from '@shared/view-state';
import type { TaskTabContext } from '../stores/task-tab-context';
import { resolveWorkspacePath } from '../stores/workspace-path';
import { EditorProvider } from './editor-provider';
import { FileContentPreview } from './file-content-preview';
import { FileContentRenderer } from './file-content-renderer';
import { FileContentToolbar } from './file-content-toolbar';
import { FILE_CONTENT_TYPES } from './file-content-types';
import { FileTabItem, FileTabDragPreview } from './file-tab-item';
import { FileTabStore } from './stores/file-tab-store';

export interface FileOpenArgs {
  path: string;
  /** When true, opens as a preview tab (replaced on next preview open). */
  preview?: boolean;
  /** When true, file is read-only from outside the workspace. */
  external?: boolean;
}

export interface FileResolvedData {
  path: string;
  isExternal: boolean;
  bufferUri: string;
  isDirty: boolean;
}

type FileDescriptor = Extract<TabDescriptor, { kind: 'file' }>;

/**
 * Mounts EditorProvider unconditionally so the Monaco instance persists across
 * tab switches. The Monaco host is overlaid and visibility-toggled rather than
 * unmounted, so cursor position and scroll survive kind transitions.
 */
const FileTabContent = observer(function FileTabContent({ host }: TabContentProps) {
  return (
    <EditorProvider>
      <FileContent host={host} />
    </EditorProvider>
  );
});

/** Renders the Monaco source and/or preview for the currently active file tab. */
const FileContent = observer(function FileContent({ host }: { host: TabHost }) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeFile =
    activeTab?.kind === 'file'
      ? host.findEntry(
          (e): e is FileTabStore =>
            (e as FileTabStore).kind === 'file' && (e as FileTabStore).tabId === activeTab.tabId
        )
      : null;

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
      {/* Top bar: file path + view mode tabs, shown whenever a file tab is active */}
      {activeFile && <FileContentToolbar tab={activeFile} canToggle={canToggle} />}

      {/* Content area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Monaco source — always mounted, visibility-toggled to preserve scroll/cursor state */}
        <div className="absolute inset-0" style={{ visibility: showSource ? 'visible' : 'hidden' }}>
          <FileContentRenderer />
        </div>

        {/* Preview — only mounted when shown, so its container never covers Monaco in source mode */}
        {activeFile && showPreview && (
          <div className="absolute inset-0">
            <FileContentPreview tab={activeFile} />
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const fileTabProvider: TabProvider<
  'file',
  FileTabStore,
  FileResolvedData,
  FileDescriptor,
  FileOpenArgs
> = {
  kind: 'file',

  resolve(entry: FileTabStore, ctx: ResolveContext): FileResolvedData {
    const bufferUri = entry.isExternal
      ? ''
      : buildMonacoModelPath((ctx as unknown as TaskTabContext).modelRootPath, entry.path);
    return {
      path: entry.path,
      isExternal: entry.isExternal,
      bufferUri,
      isDirty: entry.isExternal ? false : modelRegistry.dirtyUris.has(bufferUri),
    };
  },

  serialize(entry: FileTabStore): FileDescriptor {
    return {
      kind: 'file',
      tabId: entry.tabId,
      path: entry.path,
      isPreview: entry.isPreview,
      isExternal: entry.isExternal || undefined,
    };
  },

  deserialize(data: FileDescriptor, ctx: TabViewContext): FileTabStore {
    const filePath = data.isExternal
      ? data.path
      : resolveWorkspacePath((ctx as TaskTabContext).workspacePath, data.path);
    const tab = new FileTabStore(filePath, data.isPreview, data.tabId);
    if (data.isExternal) tab.markExternalLoading();
    return tab;
  },

  TabItem: FileTabItem,
  DragPreview: FileTabDragPreview,
  Content: FileTabContent,

  title(tab: ResolvedTab<FileResolvedData>): string {
    return tab.path.split('/').pop() ?? 'Untitled';
  },

  open(args: FileOpenArgs, host: TabHost, ctx: TabViewContext): void {
    const existing = host.findEntry(
      (e): e is FileTabStore =>
        (e as FileTabStore).kind === 'file' && (e as FileTabStore).path === args.path
    );

    if (args.preview && !args.external) {
      // Preview open: activate existing, or replace/create file preview.
      if (existing) {
        host.setActiveTab(existing.tabId);
        return;
      }
      const prevPreview = host.findEntry(
        (e): e is FileTabStore =>
          (e as FileTabStore).kind === 'file' &&
          (e as FileTabStore).isPreview &&
          !(e as FileTabStore).isExternal
      );
      const prevUri = prevPreview
        ? buildMonacoModelPath((ctx as TaskTabContext).modelRootPath, prevPreview.path)
        : null;
      const canReplace = prevPreview && prevUri && !modelRegistry.isDirty(prevUri);

      if (canReplace && prevPreview) {
        // Mutate in place — tabId unchanged, React sees one render with new content.
        prevPreview.resetForPath(args.path);
        host.setActiveTab(prevPreview.tabId);
        return;
      }

      // No clean preview to reuse. Promote dirty preview to stable, then add new one.
      if (prevPreview) prevPreview.isPreview = false;

      const tab = new FileTabStore(args.path, true);
      host.attachEntry(tab, { activate: true });
      return;
    }

    // Stable (or external) open: promote existing preview or open new tab.
    if (existing) {
      existing.isPreview = false;
      host.setActiveTab(existing.tabId);
      return;
    }

    if (args.external) {
      // Creates a loading entry; async file read is handled by FileContentPreview.
      const tab = new FileTabStore(args.path, false);
      tab.markExternalLoading();
      host.attachEntry(tab, { activate: true });
      return;
    }

    const tab = new FileTabStore(args.path, false);
    host.attachEntry(tab, { activate: true });
  },

  async confirmClose(entry: FileTabStore, _host: TabHost, ctx: TabViewContext): Promise<boolean> {
    if (entry.isExternal) return true;
    const bufferUri = buildMonacoModelPath((ctx as TaskTabContext).modelRootPath, entry.path);
    if (!modelRegistry.isDirty(bufferUri)) return true;

    const fileName = entry.path.split('/').pop() ?? entry.path;
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
};
