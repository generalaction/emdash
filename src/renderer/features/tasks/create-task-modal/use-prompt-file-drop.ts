import { useCallback, useRef, useState } from 'react';
import {
  getDraggedWorkspaceFile,
  hasDraggedFiles,
  hasDraggedWorkspaceFile,
} from '@renderer/lib/drag-files';
import { rpc } from '@renderer/lib/ipc';
import { resolveDroppedFile } from '@renderer/lib/pty/terminal-image-injection';
import { formatTerminalImagePaths } from '@renderer/lib/pty/terminal-image-paths';
import { log } from '@renderer/utils/logger';

/**
 * Drag-and-drop file support for prompt textareas: dropping OS files or
 * in-app file tree rows appends their paths (escaped like terminal drops)
 * to the prompt via `onDropText`.
 */
export function usePromptFileDrop({
  disableLocalFiles = false,
  onDropText,
}: {
  /** Reject OS file drops, e.g. for SSH projects where local paths would not exist remotely. */
  disableLocalFiles?: boolean;
  onDropText: (text: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const accepts = useCallback(
    (dataTransfer: DataTransfer) =>
      hasDraggedWorkspaceFile(dataTransfer) ||
      (!disableLocalFiles && hasDraggedFiles(dataTransfer)),
    [disableLocalFiles]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [accepts]
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      dragCounter.current++;
      setIsDragOver(true);
    },
    [accepts]
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragOver(false);
      }
    },
    [accepts]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);

      const workspaceFile = getDraggedWorkspaceFile(e.dataTransfer);
      const files = workspaceFile ? [] : Array.from(e.dataTransfer.files);
      if (!workspaceFile && files.length === 0) return;

      void (async () => {
        try {
          const platform =
            workspaceFile?.targetPlatform ?? ((await rpc.app.getPlatform()) as NodeJS.Platform);
          if (workspaceFile) {
            onDropText(formatTerminalImagePaths([workspaceFile.targetPath], platform));
            return;
          }
          const resolved = await Promise.all(files.map((file) => resolveDroppedFile(file)));
          const paths = resolved.filter((path): path is string => Boolean(path));
          if (paths.length === 0) return;
          onDropText(formatTerminalImagePaths(paths, platform));
        } catch (error) {
          log.warn('Prompt file drop failed', { error });
        }
      })();
    },
    [accepts, onDropText]
  );

  return { isDragOver, dropHandlers: { onDragOver, onDragEnter, onDragLeave, onDrop } };
}
