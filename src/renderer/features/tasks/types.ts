export type MainPanelView = 'agents' | 'editor' | 'diff';
export type RightPanelView = 'changes' | 'files' | 'terminals';

export type FileRendererData =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'markdown-source' }
  | { kind: 'svg' }
  | { kind: 'svg-source' }
  | { kind: 'image' }
  | { kind: 'binary' }
  | { kind: 'too-large' };
