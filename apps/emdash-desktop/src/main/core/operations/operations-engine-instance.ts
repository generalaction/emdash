import type { OperationsEngine, OperationsEngineHandle } from '@core/services/operations/node';

let handle: OperationsEngineHandle | undefined;

export function setOperationsEngine(nextHandle: OperationsEngineHandle): void {
  if (handle) throw new Error('Operations engine is already initialized');
  handle = nextHandle;
}

export function getOperationsEngine(): OperationsEngine {
  if (!handle) throw new Error('Operations engine has not been initialized');
  return handle.engine;
}

export async function disposeOperationsEngine(): Promise<void> {
  const current = handle;
  handle = undefined;
  await current?.dispose();
}

export function resetOperationsEngineForTests(): void {
  handle = undefined;
}
