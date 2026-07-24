import type { PortableRelativePath } from '@emdash/core/primitives/path/api';
import { createLiveModelReplica } from '@emdash/wire';
import { getEditorClient } from '@core/features/editor/api/browser/client';
import {
  hostPathFromNative,
  portablePath,
  relativeRuntimePath,
} from '@core/primitives/desktop-runtime/api';
import { editorContract, type EditorFileContentModel } from '..';

export function editorFilePath(workspaceId: string, workspacePath: string, filePath: string) {
  const root = hostPathFromNative(workspacePath);
  return {
    workspaceId,
    relative: relativeRuntimePath(root, filePath),
  };
}

export function editorRelativeFilePath(workspaceId: string, filePath: string) {
  return {
    workspaceId,
    relative: runtimeRelativePath(filePath),
  };
}

export async function watchFileContent(
  workspaceId: string,
  filePath: string,
  onChange: (content: EditorFileContentModel) => void
): Promise<() => void> {
  if (typeof window === 'undefined') return () => {};
  const client = await getEditorClient();
  const replica = createLiveModelReplica(editorContract.content, client.content);
  const lease = replica.acquire(editorRelativeFilePath(workspaceId, filePath));
  const model = await lease.ready();
  const unsubscribe = model.states.content.onChange(onChange);
  onChange(model.states.content.current());
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    void (async () => {
      try {
        await lease.release();
      } finally {
        await replica.dispose();
      }
    })();
  };
}

export async function readEditorImage(
  workspaceId: string,
  workspacePath: string,
  filePath: string
) {
  const client = await getEditorClient();
  const result = await client.fs.readBytes(editorFilePath(workspaceId, workspacePath, filePath));
  if (!result.success) return result;
  const bytes = await result.data.bytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const dataUrl = await blobToDataUrl(new Blob([buffer], { type: result.data.meta.mimeType }));
  return {
    success: true as const,
    data: {
      dataUrl,
      mimeType: result.data.meta.mimeType,
      size: result.data.meta.totalSize,
      truncated: result.data.meta.truncated,
    },
  };
}

export function runtimeRelativePath(path: string): PortableRelativePath {
  return portablePath(path.replaceAll('\\', '/'));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image read failed')), {
      once: true,
    });
    reader.readAsDataURL(blob);
  });
}
