import type { PortableRelativePath } from '@primitives/path/api';

const DEFAULT_FILE_SEARCH_EXCLUDED_SEGMENTS = [
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

/** One semantic exclusion policy compiled for scanners, watchers, and ripgrep. */
export interface FileSearchExclusions {
  excludes(path: PortableRelativePath): boolean;
  ripgrepGlobs(): readonly string[];
  watchIgnoreGlobs(): readonly string[];
}

export class DefaultFileSearchExclusions implements FileSearchExclusions {
  private readonly excluded: ReadonlySet<string>;
  private readonly segments: readonly string[];

  constructor(options: { caseSensitive?: boolean } = {}) {
    const caseSensitive = options.caseSensitive ?? process.platform !== 'win32';
    this.segments = DEFAULT_FILE_SEARCH_EXCLUDED_SEGMENTS;
    this.normalize = caseSensitive
      ? (segment) => segment
      : (segment) => segment.toLocaleLowerCase('en-US');
    this.excluded = new Set(this.segments.map(this.normalize));
  }

  excludes(path: PortableRelativePath): boolean {
    return path.split('/').some((segment) => this.excluded.has(this.normalize(segment)));
  }

  ripgrepGlobs(): readonly string[] {
    return this.segments.flatMap((segment) => [`!**/${segment}`, `!**/${segment}/**`]);
  }

  watchIgnoreGlobs(): readonly string[] {
    return this.segments.flatMap((segment) => [
      segment,
      `${segment}/**`,
      `**/${segment}`,
      `**/${segment}/**`,
    ]);
  }

  private readonly normalize: (segment: string) => string;
}
