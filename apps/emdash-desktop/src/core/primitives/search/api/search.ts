export type SearchItemKind = 'task' | 'project' | 'conversation' | 'command' | 'file';
export type PaletteEntityKind = Extract<SearchItemKind, 'task' | 'project' | 'conversation'>;

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

export interface PaletteEntitySearchQuery {
  kind: PaletteEntityKind;
  query: string;
  context?: CommandPaletteQuery['context'];
  limit?: number;
}

export interface WorkspaceFileSearchQuery {
  workspaceId: string;
  query: string;
  limit?: number;
}

export interface WorkspaceFileHit {
  path: string;
  filename: string;
}
