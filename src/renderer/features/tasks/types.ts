export type SidebarTab = 'conversations' | 'changes' | 'files';

export type FileRendererData =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'markdown-source' }
  | { kind: 'svg' }
  | { kind: 'svg-source' }
  | { kind: 'image' }
  | { kind: 'binary' }
  | { kind: 'too-large' }
  | { kind: 'file-error' };
