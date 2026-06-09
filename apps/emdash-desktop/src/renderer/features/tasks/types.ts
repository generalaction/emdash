export type SidebarTab = 'conversations' | 'changes' | 'files';

export type FileRendererData =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'markdown-source' }
  | { kind: 'html' }
  | { kind: 'html-source' }
  | { kind: 'svg' }
  | { kind: 'svg-source' }
  | { kind: 'image' }
  | { kind: 'binary' }
  | { kind: 'too-large' }
  | { kind: 'file-error' };

export type DiffRendererData =
  | { kind: 'text' } // text, markdown, html → MonacoDiffRenderer
  | { kind: 'image' } // image, svg → ImageDiffView
  | { kind: 'binary' }; // exe, zip, etc → fallback message
