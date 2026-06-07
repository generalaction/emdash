export type SearchItemKind = 'task' | 'project' | 'conversation' | 'command' | 'file';

export interface SearchItem {
  kind: SearchItemKind;
  id: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  subtitle: string;
  score: number;
}

export interface CommandPaletteQuery {
  query: string;
  context?: {
    projectId?: string;
    taskId?: string;
    workspaceId?: string;
  };
}
