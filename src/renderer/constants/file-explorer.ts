/**
 * File Explorer constants
 * Centralized configuration for file explorer behavior
 */

// Default patterns for files/directories to exclude from the file tree
export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/.git',
  '**/.svn',
  '**/.hg',
  '**/CVS',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/node_modules',
  '**/.next',
  '**/dist',
  '**/build',
  '**/.turbo',
  '**/coverage',
  '**/.nyc_output',
  '**/tmp',
  '**/.tmp',
  '**/temp',
  '**/.temp',
  '**/.cache',
  '**/.parcel-cache',
  '**/__pycache__',
  '**/.pytest_cache',
  '**/venv',
  '**/.venv',
  '**/target',
  '**/.idea',
  '**/.vscode-test',
  '**/.terraform',
  '**/.serverless',
  '**/.checkouts',
  '**/checkouts',
  '**/delete-github*',
  '**/.conductor',
  '**/.cursor',
  '**/.claude',
  '**/.amp',
  '**/.codex',
  '**/.aider',
  '**/.continue',
  '**/.cody',
  '**/.windsurf',
  '**/worktrees',
  '**/.worktrees',
];

// File extensions considered as images
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

// UI Layout constants
export const EXPLORER_WIDTH = {
  DEFAULT: 288,
  MIN: 150,
  MAX: 600,
};

// Auto-save delay in milliseconds
export const AUTO_SAVE_DELAY = 2000;

// Editor theme configuration
export const EDITOR_THEMES = {
  DARK: 'vs-dark',
  LIGHT: 'light',
} as const;

// Editor default options
export const DEFAULT_EDITOR_OPTIONS = {
  minimap: { enabled: true },
  fontSize: 13,
  lineNumbers: 'on' as const,
  rulers: [],
  wordWrap: 'on' as const,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection' as const,
  cursorBlinking: 'smooth' as const,
  smoothScrolling: true,
  formatOnPaste: true,
  formatOnType: true,
};
