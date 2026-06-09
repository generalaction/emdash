export type RemapTables = {
  sshConnectionId: Map<string, string>;
  projectId: Map<string, string>;
  taskId: Map<string, string>;
};

export function createRemapTables(): RemapTables {
  return {
    sshConnectionId: new Map(),
    projectId: new Map(),
    taskId: new Map(),
  };
}
