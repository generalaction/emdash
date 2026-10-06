import {
  ROOT_RELATIVE_PATH,
  joinAbsolute,
  joinPortableRelativePath,
  type HostAbsolutePath,
} from '@emdash/core/primitives/path/api';
import {
  isExpandableListingEntry,
  type DirectoryEntry as HostDirectoryEntry,
} from '@emdash/core/runtimes/files/api';
import { runWithTimeout, TimeoutError } from '@emdash/shared/scheduling';
import { compareFileNames } from '@emdash/shared/util';
import {
  DirectorySelector,
  useDirectoryHistory,
  type DirectoryEntry,
  type DirectoryListing,
} from '@emdash/ui/react/components';
import { Button, Input, toast } from '@emdash/ui/react/primitives';
import { type Contract, type ContractClient } from '@emdash/wire/rpc';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ProjectHostParams, type ProjectsWireContract } from '@core/features/projects/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { type Strategy } from './add-project-modal';
import { projectDirectoryLocation } from './project-directory-location';

type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
const DIRECTORY_LISTING_TIMEOUT_MS = 30_000;
export type ProjectDirectoryPickerClient = ContractClient<
  ContractDefinitionsOf<ProjectsWireContract>
>;

type ProjectDirectoryPickerProps = {
  strategy: Strategy;
  connectionId?: string;
  initialPath?: string;
  homePath: string;
  homePending: boolean;
  homeError: Error | null;
  value: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  onSelect(path: string): void;
};

export function ProjectDirectoryPicker({
  strategy,
  connectionId,
  initialPath,
  homePath,
  homePending,
  homeError,
  value,
  getProjectsClient,
  onSelect,
}: ProjectDirectoryPickerProps) {
  const host = useMemo(() => projectHostParams(strategy, connectionId), [connectionId, strategy]);
  const history = useDirectoryHistory(initialPath || homePath);
  const historyBackPath = history.backPath;
  const historyForwardPath = history.forwardPath;
  const historyBack = history.back;
  const historyForward = history.forward;
  const historyNavigate = history.navigate;
  const [locationInput, setLocationInput] = useState(history.path);
  const navigate = useCallback(
    (path: string) => {
      historyNavigate(path);
      onSelect(path);
    },
    [historyNavigate, onSelect]
  );
  const goBack = useCallback(() => {
    if (!historyBackPath) return;
    historyBack();
    onSelect(historyBackPath);
  }, [historyBack, historyBackPath, onSelect]);
  const goForward = useCallback(() => {
    if (!historyForwardPath) return;
    historyForward();
    onSelect(historyForwardPath);
  }, [historyForward, historyForwardPath, onSelect]);
  useEffect(() => setLocationInput(history.path), [history.path]);
  const location = useMemo(
    () => projectDirectoryLocation(history.path || homePath),
    [history.path, homePath]
  );
  const root = location?.root ?? null;
  const navigationRoot = location?.navigationRoot ?? homePath;
  const separator = location?.separator ?? '/';
  const directory = useHostDirectoryListing(host, root, getProjectsClient);

  const listing = directoryListing({
    homePending,
    homeError,
    listError: directory.error,
    entries: directory.entries,
  });

  async function createFolder(_parentPath: string, name: string) {
    if (!root || !host) return;

    const childPath = joinPortableRelativePath(ROOT_RELATIVE_PATH, name);
    if (!childPath.success) {
      toast.error('Invalid folder name', { description: childPath.error.message });
      return;
    }

    const result = await (
      await getProjectsClient()
    ).createHostDirectory({
      host,
      root,
      path: childPath.data,
    });
    if (!result.success) {
      toast.error('Could not create folder', { description: fsErrorMessage(result.error) });
      return;
    }

    directory.reload();
    const createdPath = joinAbsolute(root, childPath.data);
    if (!createdPath.success) {
      toast.error('Could not select folder', { description: createdPath.error.message });
      return;
    }

    onSelect(nativePathFromHost(createdPath.data));
  }

  if (!host) {
    return (
      <div className="rounded-md border border-border bg-background-1 p-3 text-sm text-foreground-muted">
        Select a machine connection before browsing remote directories.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const target = projectDirectoryLocation(locationInput.trim());
          if (!target) {
            toast.error('Invalid absolute path');
            return;
          }
          navigate(nativePathFromHost(target.root));
        }}
      >
        <Input
          aria-label="Directory location"
          value={locationInput}
          spellCheck={false}
          onChange={(event) => setLocationInput(event.currentTarget.value)}
        />
        <Button type="submit" variant="secondary">
          Go
        </Button>
      </form>
      <DirectorySelector
        path={history.path || homePath}
        navigationRoot={navigationRoot}
        listing={listing}
        selectedPath={value || null}
        canGoBack={history.canGoBack}
        canGoForward={history.canGoForward}
        separator={separator}
        onBack={goBack}
        onForward={goForward}
        onNavigate={navigate}
        onSelect={(path) => {
          if (path) onSelect(path);
        }}
        onCreateFolder={createFolder}
      />
    </div>
  );
}

/** Lists the browsed directory once per visit; the picker does not watch it. */
function useHostDirectoryListing(
  host: ProjectHostParams | null,
  root: HostAbsolutePath | null,
  getProjectsClient: () => Promise<ProjectDirectoryPickerClient>
): { entries: HostDirectoryEntry[] | null; error: string | null; reload(): void } {
  const [entries, setEntries] = useState<HostDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    setEntries(null);
    setError(null);
    if (!host || !root) return;
    let disposed = false;
    void (async () => {
      try {
        const client = await getProjectsClient();
        const result = await runWithTimeout(() => client.listHostDirectory({ host, path: root }), {
          timeoutMs: DIRECTORY_LISTING_TIMEOUT_MS,
        });
        if (disposed) return;
        if (result.success) setEntries(result.data.entries);
        else setError(fsErrorMessage(result.error));
      } catch (caught) {
        if (disposed) return;
        setError(
          caught instanceof TimeoutError
            ? 'The folder could not be listed within 30 seconds.'
            : errorMessage(caught)
        );
      }
    })();
    return () => {
      disposed = true;
    };
  }, [generation, getProjectsClient, host, root]);

  return { entries, error, reload };
}

function directoryListing({
  homePending,
  homeError,
  listError,
  entries,
}: {
  homePending: boolean;
  homeError: unknown;
  listError: string | null;
  entries: HostDirectoryEntry[] | null;
}): DirectoryListing {
  if (homeError) return { status: 'error', message: errorMessage(homeError) };
  if (listError) return { status: 'error', message: listError };
  if (homePending || !entries) return { status: 'loading' };
  return {
    status: 'ready',
    entries: [...entries].sort(compareDirectoryEntries).map(directoryEntry),
  };
}

function directoryEntry(entry: HostDirectoryEntry): DirectoryEntry {
  const metadata = { sizeBytes: entry.size, addedAtMs: entry.mtimeMs };
  if (entry.isRepository) return { name: entry.name, kind: 'repository', ...metadata };
  if (isExpandableListingEntry(entry)) return { name: entry.name, kind: 'directory', ...metadata };
  return { name: entry.name, kind: entry.kind, ...metadata };
}

function compareDirectoryEntries(left: HostDirectoryEntry, right: HostDirectoryEntry): number {
  const rank = Number(isExpandableListingEntry(right)) - Number(isExpandableListingEntry(left));
  return rank || compareFileNames(left.name, right.name);
}

function projectHostParams(
  strategy: Strategy,
  connectionId: string | undefined
): ProjectHostParams | null {
  if (strategy === 'local') return { type: 'local' };
  return connectionId ? { type: 'ssh', connectionId } : null;
}

function fsErrorMessage(error: { type: string; path?: string; message?: string }): string {
  return error.message ?? `${error.type}${error.path ? `: ${error.path}` : ''}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
