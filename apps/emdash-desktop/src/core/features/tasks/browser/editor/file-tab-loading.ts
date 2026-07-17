import type { ModelStatus } from '@renderer/lib/monaco/monaco-model-registry';

interface FileTabLoadingState {
  isExternal: boolean;
  isExternalLoading: boolean;
  isMonacoFile: boolean;
  diskStatus: ModelStatus | undefined;
}

export function isFileTabLoading({
  isExternal,
  isExternalLoading,
  isMonacoFile,
  diskStatus,
}: FileTabLoadingState): boolean {
  if (isExternal) return isMonacoFile && isExternalLoading;
  return isMonacoFile && (diskStatus ?? 'loading') === 'loading';
}
