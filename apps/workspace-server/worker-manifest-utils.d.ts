type WorkspaceWorkerManifest = Record<string, { entry: string; file: string }>;

export function workspaceWorkerBuildInputs(
  workspaceWorkers: WorkspaceWorkerManifest
): Record<string, string>;
