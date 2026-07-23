import {
  ROOT_RELATIVE_PATH,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@emdash/core/primitives/path/api';
import {
  type FileEntry,
  type FileTreeModel,
  isExpandableFileEntry,
} from '@emdash/core/runtimes/files/api';
import {
  DirectorySelector,
  useDirectoryHistory,
  type DirectoryEntry,
  type DirectoryListing,
} from '@emdash/ui/react/components';
import {
  createLiveModelReplica,
  type Contract,
  type ContractClient,
  type LiveModelReplica,
  type ReplicaInstance,
} from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  projectsWireContract,
  type ProjectHostParams,
  type ProjectsWireContract,
} from '@core/features/projects/api';
import { hostPathFromNative, relativePathWithin } from '@core/primitives/desktop-runtime/api';
import { type Strategy } from './add-project-modal';

type DirectoryTreeModel = typeof projectsWireContract.directoryTree;
type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
export type ProjectDirectoryPickerClient = ContractClient<
  ContractDefinitionsOf<ProjectsWireContract>
>;

type ProjectDirectoryPickerProps = {
  strategy: Strategy;
  connectionId?: string;
  value: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  onSelect(path: string): void;
};

export function ProjectDirectoryPicker({
  strategy,
  connectionId,
  value,
  getProjectsClient,
  onSelect,
}: ProjectDirectoryPickerProps) {
  const host = useMemo(() => projectHostParams(strategy, connectionId), [connectionId, strategy]);
  const homeQuery = useQuery({
    queryKey: ['projectHostHomeDir', host],
    queryFn: async () => {
      if (!host) throw new Error('Select a machine connection before browsing directories.');
      return (await getProjectsClient()).getHostHomeDir(host);
    },
    enabled: !!host,
  });
  const homePath = homeQuery.data ?? '';
  const history = useDirectoryHistory(homePath);
  const root = useMemo(() => (homePath ? rootForPath(homePath) : null), [homePath]);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const tree = useProjectDirectoryTree(host, root, sessionId, getProjectsClient);
  const currentRelativePath = useMemo(() => {
    if (!root || !history.path) return ROOT_RELATIVE_PATH;
    return relativePathWithin(root, hostPathFromNative(history.path));
  }, [history.path, root]);
  const reveal = useRevealDirectory(tree.model, currentRelativePath);
  void tree.revision;
  const listing = directoryListing({
    homePending: homeQuery.isPending,
    homeError: homeQuery.error,
    syncError: tree.error ?? reveal.error,
    pending: reveal.pending,
    model: tree.model?.states.tree.current() ?? null,
    path: currentRelativePath,
  });

  if (!host) {
    return (
      <div className="rounded-md border border-border bg-background-1 p-3 text-sm text-foreground-muted">
        Select a machine connection before browsing remote directories.
      </div>
    );
  }

  return (
    <DirectorySelector
      path={history.path || homePath}
      listing={listing}
      selectedPath={value || null}
      canGoBack={history.canGoBack}
      canGoForward={history.canGoForward}
      onBack={history.back}
      onForward={history.forward}
      onNavigate={history.navigate}
      onSelect={(path) => {
        if (path) onSelect(path);
      }}
    />
  );
}

function useProjectDirectoryTree(
  host: ProjectHostParams | null,
  root: HostAbsolutePath | null,
  sessionId: string,
  getProjectsClient: () => Promise<ProjectDirectoryPickerClient>
): {
  model: ReplicaInstance<DirectoryTreeModel> | null;
  revision: number;
  error: string | null;
} {
  const [model, setModel] = useState<ReplicaInstance<DirectoryTreeModel> | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host || !root) {
      setModel(null);
      return;
    }

    const currentHost = host;
    const currentRoot = root;
    let disposed = false;
    let replica: LiveModelReplica<DirectoryTreeModel> | null = null;
    let release: (() => Promise<void>) | null = null;

    async function start() {
      try {
        const client = await getProjectsClient();
        replica = createLiveModelReplica(projectsWireContract.directoryTree, client.directoryTree, {
          stores: { tree: createImmutableMobxStore },
          onChange: {
            tree: () => setRevision((current) => current + 1),
          },
        });
        const lease = replica.acquire(
          currentHost.type === 'ssh'
            ? {
                type: 'ssh',
                connectionId: currentHost.connectionId,
                root: currentRoot,
                sessionId,
              }
            : { type: 'local', root: currentRoot, sessionId }
        );
        release = () => lease.release();
        const readyModel = await lease.ready();
        if (disposed) {
          await lease.release();
          await replica.dispose();
          return;
        }
        setModel(readyModel);
        setError(null);
        setRevision((current) => current + 1);
      } catch (caught) {
        if (!disposed) setError(errorMessage(caught));
      }
    }

    void start();
    return () => {
      disposed = true;
      setModel(null);
      setError(null);
      void release?.();
      void replica?.dispose();
    };
  }, [getProjectsClient, host, root, sessionId]);

  return { model, revision, error };
}

function useRevealDirectory(
  model: ReplicaInstance<DirectoryTreeModel> | null,
  path: PortableRelativePath
): { pending: boolean; error: string | null } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!model) return;
    const currentModel = model;
    let cancelled = false;
    setPending(true);
    setError(null);

    async function reveal() {
      try {
        const mutation = await currentModel.mutations.reveal({ path, depth: 2 });
        if (!mutation.result.success) {
          throw new Error(fsErrorMessage(mutation.result.error));
        }
        await mutation.settled;
        if (!cancelled) setError(null);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setPending(false);
      }
    }

    void reveal();
    return () => {
      cancelled = true;
    };
  }, [model, path]);

  return { pending, error };
}

function directoryListing({
  homePending,
  homeError,
  syncError,
  pending,
  model,
  path,
}: {
  homePending: boolean;
  homeError: unknown;
  syncError: string | null;
  pending: boolean;
  model: FileTreeModel | null;
  path: PortableRelativePath;
}): DirectoryListing {
  if (homePending || pending || !model) return { status: 'loading' };
  if (homeError) return { status: 'error', message: errorMessage(homeError) };
  if (syncError) return { status: 'error', message: syncError };
  const entry = model.entries[path];
  if (!entry) return { status: 'loading' };
  if (!entry.childrenLoaded) return { status: 'loading' };
  return {
    status: 'ready',
    entries: entry.children.flatMap((childPath) => {
      const child = model.entries[childPath];
      return child ? [directoryEntry(child, model)] : [];
    }),
  };
}

function directoryEntry(entry: FileEntry, model: FileTreeModel): DirectoryEntry {
  if (entry.kind === 'directory' && hasGitChild(entry, model)) {
    return { name: entry.name, kind: 'repository' };
  }
  if (entry.kind === 'symlink' && entry.symlinkTargetKind === 'directory') {
    return { name: entry.name, kind: 'directory' };
  }
  return { name: entry.name, kind: entry.kind };
}

function hasGitChild(entry: FileEntry, model: FileTreeModel): boolean {
  if (!isExpandableFileEntry(entry) || !entry.childrenLoaded) return false;
  return entry.children.some((childPath) => model.entries[childPath]?.name === '.git');
}

function projectHostParams(
  strategy: Strategy,
  connectionId: string | undefined
): ProjectHostParams | null {
  if (strategy === 'local') return { type: 'local' };
  return connectionId ? { type: 'ssh', connectionId } : null;
}

function rootForPath(path: string): HostAbsolutePath {
  const parsed = hostPathFromNative(path);
  return { root: parsed.root, segments: [] };
}

function fsErrorMessage(error: { type: string; path?: string; message?: string }): string {
  return error.message ?? `${error.type}${error.path ? `: ${error.path}` : ''}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
