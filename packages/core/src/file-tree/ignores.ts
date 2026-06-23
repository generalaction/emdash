const EXCLUDED_NAMES = new Set([
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.cache',
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
]);

export function isExcludedPath(relPath: string): boolean {
  if (!relPath) return false;
  return relPath.split('/').some((segment) => EXCLUDED_NAMES.has(segment));
}

export function watchIgnoreGlobs(): string[] {
  return [...EXCLUDED_NAMES].flatMap((name) => [`**/${name}`, `**/${name}/**`]);
}
