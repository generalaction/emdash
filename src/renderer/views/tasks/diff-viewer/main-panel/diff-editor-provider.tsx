import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef } from 'react';
import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { diffEditorPool, type DiffPoolEntry } from '@renderer/core/monaco/monaco-diff-pool';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { useTheme } from '@renderer/hooks/useTheme';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';

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
  const { projectId, taskId } = useTaskViewContext();
  const diffView = asProvisioned(getTaskStore(projectId, taskId))?.diffView;
  const { effectiveTheme } = useTheme();

  // Single diff editor leased for the lifetime of DiffView.
  const leaseRef = useRef<DiffPoolEntry | null>(null);

  // Stable host element provided by FileDiffView via setDiffEditorHost.
  const hostRef = useRef<HTMLElement | null>(null);

  // Cancel fn for any pending onceBufferReady callbacks. Cleared whenever
  // activeFile changes so stale callbacks don't fire after a file switch.
  const cancelReadyCallbackRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Editor lifecycle — lease once on mount, release on unmount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    diffEditorPool.lease().then((lease) => {
      if (cancelled) {
        diffEditorPool.release(lease);
        return;
      }
      leaseRef.current = lease;

      // Append to the host element if it was already set before the lease arrived.
      if (hostRef.current) {
        hostRef.current.appendChild(lease.container);
        lease.editor.layout();
      }
    });

    return () => {
      cancelled = true;
      cancelReadyCallbackRef.current?.();
      cancelReadyCallbackRef.current = null;
      const lease = leaseRef.current;
      leaseRef.current = null;
      if (lease) diffEditorPool.release(lease);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Theme sync — update diff editor theme when app theme changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    diffEditorPool.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // ---------------------------------------------------------------------------
  // Model switching — MobX reaction drives applyContent when activeFile changes.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => diffView?.activeFile ?? null,
        (activeFile) => {
          // Cancel any pending ready-callbacks for the previous file.
          cancelReadyCallbackRef.current?.();
          cancelReadyCallbackRef.current = null;

          const lease = leaseRef.current;
          if (!lease) return;

          if (!activeFile || isBinaryForDiff(activeFile.path)) {
            lease.editor.setModel(null);
            return;
          }

          const root = `task:${taskId}`;
          const uri = buildMonacoModelPath(root, activeFile.path);
          const language = getLanguageFromPath(activeFile.path);

          // Compute the correct URI pair based on the diff type.
          // 'disk'   — original = git at originalRef; modified = disk://
          // 'staged' — original = git://HEAD;         modified = git://staged
          // 'git'    — original = git at originalRef; modified = git://HEAD
          const originalUri = modelRegistry.toGitUri(
            uri,
            activeFile.type === 'staged' ? 'HEAD' : activeFile.originalRef
          );
          const modifiedUri =
            activeFile.type === 'disk'
              ? modelRegistry.toDiskUri(uri)
              : modelRegistry.toGitUri(uri, activeFile.type === 'staged' ? 'staged' : 'HEAD');

          // Register models (idempotent/ref-counted). If StackedDiffView has
          // already registered them, these are fast no-ops.
          if (activeFile.type === 'disk') {
            void modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              activeFile.path,
              language,
              'disk'
            );
            void modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              activeFile.path,
              language,
              'git',
              activeFile.originalRef
            );
          } else if (activeFile.type === 'staged') {
            void modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              activeFile.path,
              language,
              'git',
              'HEAD'
            );
            void modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              activeFile.path,
              language,
              'git',
              'staged'
            );
          } else {
            void modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              activeFile.path,
              language,
              'git',
              activeFile.originalRef
            );
            void modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              activeFile.path,
              language,
              'git',
              'HEAD'
            );
          }

          // Immediate apply — works when models are already in the registry
          // (e.g. StackedDiffView pre-registered them, or we've seen this file before).
          diffEditorPool.applyContent(lease, originalUri, modifiedUri, language);

          // Deferred apply — covers the async registration race on first load.
          // onceBufferReady fires immediately if the model already exists, so the
          // second applyContent call is a harmless no-op in the common fast path.
          let ready = 0;
          const tryApply = () => {
            if (++ready === 2) {
              if (leaseRef.current) {
                diffEditorPool.applyContent(leaseRef.current, originalUri, modifiedUri, language);
              }
            }
          };
          const c1 = modelRegistry.onceBufferReady(originalUri, tryApply);
          const c2 = modelRegistry.onceBufferReady(modifiedUri, tryApply);
          cancelReadyCallbackRef.current = () => {
            c1();
            c2();
          };
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // DiffStyle sync — MobX reaction updates renderSideBySide when style changes.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => diffView?.diffStyle ?? 'unified',
        (style) => {
          const lease = leaseRef.current;
          if (!lease) return;
          lease.editor.updateOptions({ renderSideBySide: style === 'split' });
          lease.editor.layout();
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // setDiffEditorHost — called by FileDiffView to give the editor a stable DOM node.
  // ---------------------------------------------------------------------------
  const setDiffEditorHost = useCallback((el: HTMLElement | null) => {
    hostRef.current = el;
    if (el && leaseRef.current?.container) {
      el.appendChild(leaseRef.current.container);
      leaseRef.current.editor.layout();
    }
  }, []);

  return (
    <DiffEditorContext.Provider value={{ setDiffEditorHost }}>
      {children}
    </DiffEditorContext.Provider>
  );
});
