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
import { EditorProvider } from './editor-provider';
import { FileRenderer } from './file-renderer';
import { FileTabItem, FileTabDragPreview } from './file-tab-item';
import { MonacoFileRenderer } from './monaco-file-renderer';
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
      <FileTabBody host={host} />
    </EditorProvider>
  );
});

const MONACO_KINDS = new Set(['text', 'svg-source', 'html-source', 'markdown-source']);

const FileTabBody = observer(function FileTabBody({ host }: { host: TabHost }) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeFile =
    activeTab?.kind === 'file'
      ? host.findEntry(
          (e): e is FileTabStore =>
            (e as FileTabStore).kind === 'file' && (e as FileTabStore).tabId === activeTab.tabId
        )
      : null;

  const monacoActive = activeFile ? MONACO_KINDS.has(activeFile.renderer.kind) : false;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0" style={{ visibility: monacoActive ? 'visible' : 'hidden' }}>
        <MonacoFileRenderer />
      </div>
      {activeFile && (
        <div className="absolute inset-0">
          <FileRenderer tab={activeFile} />
        </div>
      )}
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

  deserialize(data: FileDescriptor, _ctx: TabViewContext): FileTabStore {
    const tab = new FileTabStore(data.path, data.isPreview, data.tabId);
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
      // Creates a loading entry; async file read is handled by FileRenderer in Phase 4.
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
