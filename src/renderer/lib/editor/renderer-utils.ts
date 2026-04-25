import { FileRendererData } from '@renderer/features/tasks/types';
import { getFileKind } from './fileKind';

/** Returns the default renderer for a file based on its kind. */
export function getDefaultRenderer(kind: ReturnType<typeof getFileKind>): FileRendererData {
  switch (kind) {
    case 'markdown':
      return { kind: 'markdown' };
    case 'svg':
      return { kind: 'svg' };
    default:
      return { kind } as FileRendererData;
  }
}
