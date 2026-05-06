export type SearchItemKind = 'task' | 'project';

export interface SearchItem {
  kind: SearchItemKind;
  id: string;
  projectId: string | null;
  title: string;
  subtitle: string;
  score: number;
}

export interface CommandPaletteQuery {
  query: string;
  context?: {
    projectId?: string;
    taskId?: string;
  };
}
