import { autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef } from 'react';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { isBinaryForDiff } from '@renderer/lib/editor/fileKind';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { diffEditorPool } from '@renderer/lib/monaco/monaco-diff-pool';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { useMonacoLease } from '@renderer/lib/monaco/use-monaco-lease';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';

interface DiffEditorContextValue {
  /**
   * Ref callback that appends the stable diff editor container to the given
   * DOM element. Called by FileDiffView to position the editor host.
   */
  setDiffEditorHost: (el: HTMLElement | null) => void;
}

const DiffEditorContext = createContext<DiffEditorContextValue | null>(null);

export function useDiffEditorContext(): DiffEditorContextValue {
  const ctx = useContext(DiffEditorContext);
  if (!ctx) throw new Error('useDiffEditorContext must be used within DiffEditorProvider');
  return ctx;
}

export const DiffEditorProvider = observer(function DiffEditorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const diffView = provisioned.taskView.diffView;
  const { effectiveTheme } = useTheme();

  // Lease is exposed as a MobX observable box — all three async signals
  // (lease, activeFile, modelStatus) are unified in a single autorun below.
  const leaseBox = useMonacoLease(diffEditorPool);

  // Stable host element provided by FileDiffView via setDiffEditorHost.
  const hostRef = useRef<HTMLElement | null>(null);

  // ---------------------------------------------------------------------------
  // Theme sync — update diff editor theme when app theme changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    diffEditorPool.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // ---------------------------------------------------------------------------
  // Host appending — fires when the lease arrives (covers lease-after-host order).
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => leaseBox.get(),
        (lease) => {
          if (lease && hostRef.current) {
            hostRef.current.appendChild(lease.container);
            lease.editor.layout();
          }
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // DiffStyle sync — fires when the lease arrives OR when diffStyle changes,
  // ensuring renderSideBySide always reflects the current setting.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => ({ lease: leaseBox.get(), style: diffView.diffStyle }),
        ({ lease, style }) => {
          if (!lease) return;
          lease.editor.updateOptions({ renderSideBySide: style === 'split' });
          lease.editor.layout();
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Model registration — triggered on activeFile change only.
  // Idempotent/ref-counted; fast no-ops if StackedDiffView pre-registered them.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => diffView.activeFile ?? null,
        (activeFile) => {
          if (!activeFile || isBinaryForDiff(activeFile.path)) return;
          const root = `workspace:${workspaceId}`;
          const language = getLanguageFromPath(activeFile.path);
          if (activeFile.type === 'disk') {
            void modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              activeFile.path,
              language,
              'disk'
            );
            void modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              activeFile.path,
              language,
              'git',
              activeFile.originalRef
            );
          } else if (activeFile.type === 'staged') {
            void modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              activeFile.path,
              language,
              'git',
              'HEAD'
            );
            void modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              activeFile.path,
              language,
              'git',
              'staged'
            );
          } else {
            void modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              activeFile.path,
              language,
              'git',
              activeFile.originalRef
            );
            void modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              activeFile.path,
              language,
              'git',
              'HEAD'
            );
          }
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Content application — single autorun that re-evaluates whenever any of the
  // three inputs changes: lease, activeFile, or modelStatus.
  // Covers: initial mount, remount after task switching, rapid file switching,
  // and the async model-loading race on first load.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      autorun(() => {
        const lease = leaseBox.get(); // reactive
        const activeFile = diffView.activeFile; // reactive

        if (!lease) return;

        if (!activeFile || isBinaryForDiff(activeFile.path)) {
          lease.editor.setModel(null);
          return;
        }

        const root = `workspace:${workspaceId}`;
        const uri = buildMonacoModelPath(root, activeFile.path);
        const language = getLanguageFromPath(activeFile.path);

        const originalUri = modelRegistry.toGitUri(
          uri,
          activeFile.type === 'staged' ? 'HEAD' : activeFile.originalRef
        );
        const modifiedUri =
          activeFile.type === 'disk'
            ? modelRegistry.toDiskUri(uri)
            : modelRegistry.toGitUri(uri, activeFile.type === 'staged' ? 'staged' : 'HEAD');

        // Reactive reads — autorun re-evaluates when statuses change to 'ready'.
        const origStatus = modelRegistry.modelStatus.get(originalUri); // reactive
        const modStatus = modelRegistry.modelStatus.get(modifiedUri); // reactive
        if (origStatus !== 'ready' || modStatus !== 'ready') return;

        diffEditorPool.applyContent(lease, originalUri, modifiedUri, language);
        lease.editor.layout();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // setDiffEditorHost — called by FileDiffView to give the editor a stable DOM
  // node. Handles host-arriving-after-lease order; the reaction above handles
  // the lease-arriving-after-host order.
  // ---------------------------------------------------------------------------
  const setDiffEditorHost = useCallback(
    (el: HTMLElement | null) => {
      hostRef.current = el;
      const lease = leaseBox.get();
      if (el && lease) {
        el.appendChild(lease.container);
        lease.editor.layout();
      }
    },
    [leaseBox]
  );

  return (
    <DiffEditorContext.Provider value={{ setDiffEditorHost }}>
      {children}
    </DiffEditorContext.Provider>
  );
});
