export const LEGACY_SSH_IGNORED_PATH_SEGMENTS = [
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'out',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  'tmp',
  'temp',
  '.DS_Store',
  'Thumbs.db',
  '.vscode-test',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  '.checkouts',
  'checkouts',
  '.conductor',
  '.cursor',
  '.claude',
  '.devin',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
  'worktrees',
  '.worktrees',
  '.emdash',
  'node_modules',
] as const;

const LEGACY_SSH_IGNORED_PATH_SEGMENT_SET = new Set<string>(LEGACY_SSH_IGNORED_PATH_SEGMENTS);

export function isLegacySshIgnoredRelativePath(relativePath: string): boolean {
  if (!relativePath) return false;
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => LEGACY_SSH_IGNORED_PATH_SEGMENT_SET.has(segment));
}
