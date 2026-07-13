import type { PortableRelativePath } from '@emdash/core/primitives/path/api';
import { filesContract, type FileContentModel } from '@emdash/core/runtimes/files/api';
import { createLiveModelReplica } from '@emdash/wire';
import { hostPathFromNative, portablePath, relativeRuntimePath } from '@shared/core/runtime/paths';
import { getFilesRuntimeClient } from './files-client';

export function filesPath(workspacePath: string, filePath: string) {
  const root = hostPathFromNative(workspacePath);
  return {
    root,
    relative: relativeRuntimePath(root, filePath),
  };
}

export async function watchFileContent(
  workspacePath: string,
  filePath: string,
  onChange: (content: FileContentModel) => void
): Promise<() => void> {
  const client = await getFilesRuntimeClient();
  const replica = createLiveModelReplica(filesContract.content, client.content);
  const lease = replica.acquire(filesPath(workspacePath, filePath));
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

export async function readRuntimeImage(workspacePath: string, filePath: string) {
  const client = await getFilesRuntimeClient();
  const result = await client.fs.readBytes(filesPath(workspacePath, filePath));
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
