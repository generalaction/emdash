import { observer } from 'mobx-react-lite';
import { FileRenderer } from '@renderer/features/tasks/view/renderers/file-renderer';
import {
  FileTabItem,
  FileTabDragPreview,
} from '@renderer/features/tasks/view/tab-bar/file-tab-item';
import { TabContextMenu } from '@renderer/features/tasks/view/tab-bar/tab-context-menu';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { TabDescriptor } from '@shared/view-state';
import type {
  TabProvider,
  TabHost,
  TabItemProps,
  TabKindContext,
  TabRendererProps,
  ResolvedTab,
  ResolveContext,
} from '../core/tab-provider';
import { registerTabProvider } from '../core/tab-provider-registry';
import { FileTabStore } from '../file-tab-store';
import type { ResolvedFileTab } from '../pane-store';

// ---------------------------------------------------------------------------
// Registry augmentation — enables typed manager.open('file', args)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// UI adapters
// ---------------------------------------------------------------------------

function FileTabItemAdapter({ tab, host, ctx }: TabItemProps<FileResolvedData>) {
  return (
    <TabContextMenu tab={tab} host={host} ctx={ctx}>
      <FileTabItem
        tab={tab as ResolvedFileTab}
        onSelect={() => host.setActiveTab(tab.tabId)}
        onPin={() => host.pin(tab.tabId)}
        onClose={() => host.requestCloseTab(tab.tabId)}
      />
    </TabContextMenu>
  );
}

function FileDragPreviewAdapter({ tab }: { tab: ResolvedTab<FileResolvedData> }) {
  return <FileTabDragPreview tab={tab as ResolvedFileTab} />;
}

/**
 * Renders the active file tab; returns null when no file tab is active.
 * FileRenderer uses ShowHide internally to keep Monaco alive across tab switches.
 */
const FileTabRenderer = observer(function FileTabRenderer({ host }: TabRendererProps) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  if (activeTab?.kind !== 'file') return null;
  const activeTabId = activeTab.tabId;
  const entry = host.findEntry((e): e is FileTabStore => {
    const s = e as FileTabStore;
    return s.kind === 'file' && s.tabId === activeTabId;
  });
  if (!entry) return null;
  return <FileRenderer tab={entry} />;
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const fileTabProvider: TabProvider<
  FileTabStore,
  FileResolvedData,
  FileDescriptor,
  FileOpenArgs
> = {
  kind: 'file',

  resolve(entry: FileTabStore, ctx: ResolveContext): FileResolvedData {
    const bufferUri = entry.isExternal ? '' : buildMonacoModelPath(ctx.modelRootPath, entry.path);
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

  deserialize(data: FileDescriptor, _ctx: TabKindContext): FileTabStore {
    const tab = new FileTabStore(data.path, data.isPreview, data.tabId);
    if (data.isExternal) tab.markExternalLoading();
    return tab;
  },

  TabItem: FileTabItemAdapter,
  DragPreview: FileDragPreviewAdapter,
  Renderer: FileTabRenderer,

  title(tab: ResolvedTab<FileResolvedData>): string {
    return tab.path.split('/').pop() ?? 'Untitled';
  },

  open(args: FileOpenArgs, host: TabHost, ctx: TabKindContext): void {
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
        ? buildMonacoModelPath(ctx.modelRootPath, prevPreview.path)
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

  async confirmClose(entry: FileTabStore, _host: TabHost, ctx: TabKindContext): Promise<boolean> {
    if (entry.isExternal) return true;
    const bufferUri = buildMonacoModelPath(ctx.modelRootPath, entry.path);
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

registerTabProvider(fileTabProvider);
