import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getFileKind } from '@renderer/core/editor/fileKind';
import type { ManagedFile, ManagedFileKind } from '@renderer/core/editor/types';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import {
  useTaskViewState,
  type FileRendererData,
  type OpenedFile,
} from '@renderer/core/tasks/task-view-state-provider';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { useTaskViewContext } from '../task-view-context';

interface EditorContextValue {
  projectId: string;
  taskId: string;
  modelRootPath: string;

  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  activeFile: ManagedFile | null;
  isSaving: boolean;

  /** Path of the current unstable/preview tab (italic in the tab bar). Null when all tabs are stable. */
  previewFilePath: string | null;

  loadFile: (filePath: string) => Promise<void>;
  /** Opens a file as an unstable preview tab; replaces the existing preview tab if clean. */
  openFilePreview: (filePath: string) => Promise<void>;
  /** Promotes the preview tab to a stable tab. */
  pinFile: (filePath: string) => void;
  saveFile: (filePath?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string | null) => void;

  /** Ordered list of open tabs with stable `tabId` for use as React keys. */
  tabs: Array<{ tabId: string; filePath: string }>;

  fileChanges: { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }[];

  handleCloseFile: (filePath: string) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorContext must be used within EditorProvider');
  return ctx;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const { task } = useTaskViewContext();

  const projectId = task?.projectId ?? '';
  const taskId = task?.id ?? '';
  const modelRootPath = `task:${taskId}`;

  const restoringRef = useRef(false);
  /** Maps filePath → stable tabId for all currently open files. */
  const tabIdsRef = useRef<Map<string, string>>(new Map());

  const { getTaskViewState, setTaskViewState } = useTaskViewState();

  const [openFiles, setOpenFiles] = useState<Map<string, ManagedFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeFile = activeFilePath ? (openFiles.get(activeFilePath) ?? null) : null;

  // Persist open tabs / active and preview pointers to view state.
  useEffect(() => {
    if (restoringRef.current) return;

    // Preserve existing previewMode values while rebuilding the openedFiles list.
    const currentOpenedFiles = getTaskViewState(taskId).editorView.openedFiles;
    const prevByPath = new Map(currentOpenedFiles.map((f) => [f.path, f]));

    const openedFiles: OpenedFile[] = Array.from(openFiles.keys()).map((filePath) => {
      const file = openFiles.get(filePath)!;
      const tabId = tabIdsRef.current.get(filePath) ?? filePath;
      const prev = prevByPath.get(filePath);

      let renderer: FileRendererData;
      if (file.kind === 'text' || file.kind === 'svg') {
        const prevPreview =
          prev?.renderer.kind === file.kind
            ? (prev.renderer as { kind: 'text' | 'svg'; previewMode?: boolean }).previewMode
            : undefined;
        renderer =
          prevPreview !== undefined
            ? { kind: file.kind, previewMode: prevPreview }
            : { kind: file.kind };
      } else {
        renderer = { kind: file.kind as Exclude<ManagedFileKind, 'text' | 'svg'> };
      }

      return { tabId, path: filePath, renderer };
    });

    setTaskViewState(taskId, {
      editorView: {
        ...getTaskViewState(taskId).editorView,
        openedFiles,
        activeTabId: activeFilePath ? tabIdsRef.current.get(activeFilePath) : undefined,
        previewTabId: previewFilePath ? tabIdsRef.current.get(previewFilePath) : undefined,
      },
    });
    // getTaskViewState is intentionally excluded — used only to read current editorView for merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, openFiles, activeFilePath, previewFilePath, setTaskViewState]);

  /**
   * Internal: load a file's content and register models in the registry.
   *
   * Three-phase approach to eliminate the "no file open" flash and show a
   * loading state for slow (e.g. SSH) reads:
   *
   * 1. **Synchronous** — insert a `{ isLoading: true }` placeholder into
   *    `openFiles` immediately so the tab bar is never empty.
   * 2. **Async I/O** — read/fetch the file content via RPC.
   * 3. **Settle** — replace the placeholder with the final `ManagedFile`.
   */
  const loadFileInternal = useCallback(
    async (filePath: string) => {
      // Assign a stable tabId the first time this file is opened.
      if (!tabIdsRef.current.has(filePath)) {
        tabIdsRef.current.set(filePath, crypto.randomUUID());
      }

      const kind = getFileKind(filePath);

      // Phase 1 — synchronous placeholder (no await, no flash).
      setOpenFiles((prev) =>
        new Map(prev).set(filePath, {
          path: filePath,
          kind,
          isLoading: kind !== 'binary', // binary needs no I/O
          content: '',
        })
      );

      // Phase 2+3 — async I/O, then replace placeholder.
      if (kind === 'binary') {
        // Nothing to load — placeholder already has isLoading: false.
        return;
      }

      if (kind === 'image') {
        const result = await rpc.fs.readImage(projectId, taskId, filePath);
        const dataUrl = result.success ? (result.data?.dataUrl ?? '') : '';
        setOpenFiles((prev) =>
          new Map(prev).set(filePath, {
            path: filePath,
            kind: 'image',
            isLoading: false,
            content: dataUrl,
          })
        );
        return;
      }

      // 'text' and 'svg': pre-read to detect truncation before registering Monaco models.
      const readResult = await rpc.fs.readFile(projectId, taskId, filePath);

      if (!readResult.success) {
        setOpenFiles((prev) =>
          new Map(prev).set(filePath, {
            path: filePath,
            kind: 'binary', // treat unreadable files as unsupported
            isLoading: false,
            content: '',
          })
        );
        return;
      }

      if (readResult.data?.truncated) {
        setOpenFiles((prev) =>
          new Map(prev).set(filePath, {
            path: filePath,
            kind: 'too-large',
            isLoading: false,
            content: '',
            totalSize: readResult.data?.totalSize,
          })
        );
        return;
      }

      const language = getMonacoLanguageId(filePath);

      // Register disk first (buffer seeds from it), then git baseline, then buffer.
      // Awaiting all three before setting state guarantees models exist for PooledCodeEditor
      // and useDiffDecorations.
      await modelRegistry.registerModel(
        projectId,
        taskId,
        modelRootPath,
        filePath,
        language,
        'disk'
      );
      await modelRegistry.registerModel(
        projectId,
        taskId,
        modelRootPath,
        filePath,
        language,
        'git'
      );
      await modelRegistry.registerModel(
        projectId,
        taskId,
        modelRootPath,
        filePath,
        language,
        'buffer'
      );

      const diskValue =
        modelRegistry.getDiskValue(buildMonacoModelPath(modelRootPath, filePath)) ?? '';
      setOpenFiles((prev) =>
        new Map(prev).set(filePath, {
          path: filePath,
          kind, // 'text' or 'svg'
          isLoading: false,
          content: diskValue,
        })
      );
    },
    [projectId, taskId, modelRootPath]
  );

  // Restore open files from view state on mount, then apply any persisted unsaved buffers.
  useEffect(() => {
    if (!taskId) return;
    restoringRef.current = true;

    const { editorView } = getTaskViewState(taskId);

    const restore = async () => {
      if (editorView.openedFiles.length) {
        for (const { tabId, path: filePath } of editorView.openedFiles) {
          tabIdsRef.current.set(filePath, tabId);
          await loadFileInternal(filePath).catch(() => {
            // Skip missing / deleted files silently.
          });
        }

        const openPaths = new Set(editorView.openedFiles.map((f) => f.path));

        if (editorView.activeTabId) {
          const activeFile = editorView.openedFiles.find((f) => f.tabId === editorView.activeTabId);
          if (activeFile && openPaths.has(activeFile.path)) {
            setActiveFilePath(activeFile.path);
          }
        }

        if (editorView.previewTabId) {
          const previewFile = editorView.openedFiles.find(
            (f) => f.tabId === editorView.previewTabId
          );
          if (previewFile && openPaths.has(previewFile.path)) {
            setPreviewFilePath(previewFile.path);
          }
        }
      }

      // Restore persisted unsaved buffers into the buffer models.
      if (projectId && taskId) {
        try {
          const buffers = await rpc.editorBuffer.listBuffers(projectId, taskId);
          for (const { filePath, content } of buffers) {
            const uri = buildMonacoModelPath(modelRootPath, filePath);
            const model = modelRegistry.getModelByUri(uri);
            if (model) {
              model.setValue(content);
            }
          }
        } catch (e) {
          console.warn('[EditorProvider] Failed to restore buffers:', e);
        }
      }

      restoringRef.current = false;
    };

    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Conflict dialog — shown lazily from saveFile when a pending conflict is detected.
  const showConflictModal = useShowModal('conflictDialog');

  const loadFile = useCallback(
    async (filePath: string) => {
      await loadFileInternal(filePath);
      // Promote to stable if it was the preview tab.
      setPreviewFilePath((prev) => (prev === filePath ? null : prev));
      setActiveFilePath(filePath);
    },
    [loadFileInternal]
  );

  const saveFile = useCallback(
    async (filePath?: string) => {
      const targetPath = filePath ?? activeFilePath;
      if (!targetPath) return;

      const uri = buildMonacoModelPath(modelRootPath, targetPath);
      if (!modelRegistry.isDirty(uri)) return;

      // If the file was externally modified while the buffer had unsaved edits,
      // show the conflict dialog before writing. The save completes inside onSuccess
      // so the user's choice is applied atomically.
      if (modelRegistry.hasPendingConflict(uri)) {
        showConflictModal({
          filePath: targetPath,
          onSuccess: async (accept) => {
            if (accept) {
              // "Accept Incoming" — discard user edits, reload buffer from disk.
              modelRegistry.reloadFromDisk(uri); // also clears pendingConflict
              void rpc.editorBuffer.clearBuffer(projectId, taskId, targetPath);
              const content = modelRegistry.getDiskValue(uri) ?? '';
              setOpenFiles((prev) => {
                const next = new Map(prev);
                const existing = next.get(targetPath);
                if (existing) {
                  next.set(targetPath, { ...existing, content });
                }
                return next;
              });
            } else {
              // "Keep Mine" — write the user's buffer to disk.
              setIsSaving(true);
              try {
                const content = await modelRegistry.saveFileToDisk(uri); // also clears pendingConflict
                if (content !== null) {
                  setOpenFiles((prev) => {
                    const next = new Map(prev);
                    const updated = next.get(targetPath);
                    if (updated) {
                      next.set(targetPath, { ...updated, content });
                    }
                    return next;
                  });
                }
              } finally {
                setIsSaving(false);
              }
            }
          },
        });
        return;
      }

      setIsSaving(true);
      try {
        const content = await modelRegistry.saveFileToDisk(uri);
        if (content !== null) {
          setOpenFiles((prev) => {
            const next = new Map(prev);
            const updated = next.get(targetPath);
            if (updated) {
              next.set(targetPath, { ...updated, content });
            }
            return next;
          });
        } else {
          console.error('Failed to save file:', targetPath);
        }
      } catch (error) {
        console.error('Error saving file:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [activeFilePath, modelRootPath, projectId, taskId, showConflictModal]
  );

  const saveAllFiles = useCallback(async () => {
    const dirtyPaths = Array.from(openFiles.keys()).filter((p) =>
      modelRegistry.isDirty(buildMonacoModelPath(modelRootPath, p))
    );
    for (const path of dirtyPaths) {
      await saveFile(path);
    }
  }, [openFiles, modelRootPath, saveFile]);

  const closeFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
      setActiveFilePath((prev) => {
        if (prev !== filePath) return prev;
        const keys = Array.from(openFiles.keys()).filter((k) => k !== filePath);
        return keys[keys.length - 1] ?? null;
      });
    },
    [openFiles]
  );

  const setActiveFile = useCallback((filePath: string | null) => {
    setActiveFilePath(filePath);
  }, []);

  const handleCloseFile = useCallback(
    (filePath: string) => {
      tabIdsRef.current.delete(filePath);

      const uri = buildMonacoModelPath(modelRootPath, filePath);
      // Decrement ref counts; models are disposed when counts reach 0.
      modelRegistry.unregisterModel(uri);
      modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, 'HEAD'));
      void rpc.editorBuffer.clearBuffer(projectId, taskId, filePath);

      closeFile(filePath);
      // previewMode cleanup is implicit: the sync effect rebuilds openedFiles
      // from openFiles, so the closed file's renderer data is naturally dropped.
      setPreviewFilePath((prev) => (prev === filePath ? null : prev));
    },
    [closeFile, projectId, taskId, modelRootPath]
  );

  /**
   * Opens a file as an unstable preview tab (single-click behaviour).
   * If there is already a clean preview tab, it is closed and replaced.
   * If the file is already open (stable or preview), it is simply activated.
   *
   * Load order is intentionally reversed vs the old approach:
   *   NEW: load new file first → close old preview
   * The synchronous loading placeholder added by `loadFileInternal` ensures
   * `openFiles` is never empty during the transition, eliminating the flash.
   */
  const openFilePreview = useCallback(
    async (filePath: string) => {
      if (openFiles.has(filePath)) {
        setActiveFilePath(filePath);
        return;
      }

      // Capture the outgoing preview path before any awaits.
      const outgoingPreview = previewFilePath;

      // Load the new file first. The synchronous placeholder phase of
      // loadFileInternal immediately adds the new entry to openFiles, so the
      // tab bar is never empty while waiting for async I/O to complete.
      await loadFileInternal(filePath);
      setPreviewFilePath(filePath);
      setActiveFilePath(filePath);

      // Now it is safe to remove the old preview — the new file is already present.
      if (outgoingPreview && outgoingPreview !== filePath) {
        const outgoingUri = buildMonacoModelPath(modelRootPath, outgoingPreview);
        setOpenFiles((prev) => {
          const previewFile = prev.get(outgoingPreview);
          if (!previewFile || modelRegistry.isDirty(outgoingUri)) return prev;

          // Clean up Monaco models for the outgoing preview tab.
          modelRegistry.unregisterModel(outgoingUri);
          modelRegistry.unregisterModel(modelRegistry.toDiskUri(outgoingUri));
          void rpc.editorBuffer.clearBuffer(projectId, taskId, outgoingPreview);
          // previewMode cleanup is implicit via the sync effect.

          const next = new Map(prev);
          next.delete(outgoingPreview);
          return next;
        });
        setPreviewFilePath(filePath);
      }
    },
    [openFiles, previewFilePath, loadFileInternal, modelRootPath, projectId, taskId]
  );

  /** Promotes the preview tab to a stable tab (double-click on tab). */
  const pinFile = useCallback((filePath: string) => {
    setPreviewFilePath((prev) => (prev === filePath ? null : prev));
  }, []);

  const tabs = Array.from(openFiles.keys()).map((filePath) => ({
    tabId: tabIdsRef.current.get(filePath) ?? filePath,
    filePath,
  }));

  // Cleanup: unregister all models for this task on unmount.
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  useEffect(() => {
    return () => {
      if (!projectId || !taskId) return;
      for (const filePath of openFilesRef.current.keys()) {
        const uri = buildMonacoModelPath(modelRootPath, filePath);
        modelRegistry.unregisterModel(uri);
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      }
    };
    // Only run on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <EditorContext.Provider
      value={{
        projectId,
        taskId,
        modelRootPath,
        openFiles,
        tabs,
        activeFilePath,
        activeFile,
        isSaving,
        previewFilePath,
        loadFile,
        openFilePreview,
        pinFile,
        saveFile,
        saveAllFiles,
        closeFile,
        setActiveFile,
        fileChanges: [],
        handleCloseFile,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}
