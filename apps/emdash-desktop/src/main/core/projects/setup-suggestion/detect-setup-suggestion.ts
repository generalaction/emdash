import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { SetupScriptSuggestion } from '@shared/core/projects/setup-suggestion';

type SetupSuggestionRule = SetupScriptSuggestion & {
  /** Root-relative marker files; the rule matches if any of them exists. */
  anyOf: string[];
};

/**
 * Ordered detection rules. The first rule with a matching marker file wins, so
 * more specific signals (lockfiles that pin a package manager) come before the
 * generic fallbacks (a bare `package.json`).
 */
const SETUP_SUGGESTION_RULES: readonly SetupSuggestionRule[] = [
  { tool: 'bun', displayName: 'Bun', command: 'bun install', anyOf: ['bun.lockb', 'bun.lock'] },
  { tool: 'pnpm', displayName: 'pnpm', command: 'pnpm install', anyOf: ['pnpm-lock.yaml'] },
  { tool: 'yarn', displayName: 'Yarn', command: 'yarn install', anyOf: ['yarn.lock'] },
  { tool: 'npm', displayName: 'npm', command: 'npm install', anyOf: ['package-lock.json'] },
  { tool: 'node', displayName: 'Node.js', command: 'npm install', anyOf: ['package.json'] },
  { tool: 'cargo', displayName: 'Cargo', command: 'cargo build', anyOf: ['Cargo.toml'] },
  { tool: 'go', displayName: 'Go', command: 'go mod download', anyOf: ['go.mod'] },
  { tool: 'uv', displayName: 'uv', command: 'uv sync', anyOf: ['uv.lock'] },
  { tool: 'poetry', displayName: 'Poetry', command: 'poetry install', anyOf: ['poetry.lock'] },
  { tool: 'pipenv', displayName: 'Pipenv', command: 'pipenv install', anyOf: ['Pipfile'] },
  {
    tool: 'pip',
    displayName: 'pip',
    command: 'pip install -r requirements.txt',
    anyOf: ['requirements.txt'],
  },
  { tool: 'python', displayName: 'Python', command: 'pip install .', anyOf: ['pyproject.toml'] },
  { tool: 'bundler', displayName: 'Bundler', command: 'bundle install', anyOf: ['Gemfile'] },
  {
    tool: 'composer',
    displayName: 'Composer',
    command: 'composer install',
    anyOf: ['composer.json'],
  },
  {
    tool: 'gradle',
    displayName: 'Gradle',
    command: './gradlew build',
    anyOf: ['build.gradle', 'build.gradle.kts'],
  },
  { tool: 'maven', displayName: 'Maven', command: 'mvn install', anyOf: ['pom.xml'] },
  { tool: 'mix', displayName: 'Mix', command: 'mix deps.get', anyOf: ['mix.exs'] },
  {
    tool: 'swift',
    displayName: 'Swift',
    command: 'swift package resolve',
    anyOf: ['Package.swift'],
  },
  { tool: 'dart', displayName: 'Dart', command: 'dart pub get', anyOf: ['pubspec.yaml'] },
];

async function markerExists(
  fs: Pick<FileSystemProvider, 'exists'>,
  path: string
): Promise<boolean> {
  try {
    return await fs.exists(path);
  } catch (error) {
    log.warn('detectSetupSuggestion: exists() check failed', { path, error });
    return false;
  }
}

/**
 * Inspect the project root for known tooling markers and return a single best
 * setup-command suggestion, or null when nothing recognizable is found.
 */
export async function detectSetupSuggestion(
  fs: Pick<FileSystemProvider, 'exists'>
): Promise<SetupScriptSuggestion | null> {
  for (const rule of SETUP_SUGGESTION_RULES) {
    for (const marker of rule.anyOf) {
      if (await markerExists(fs, marker)) {
        return { tool: rule.tool, displayName: rule.displayName, command: rule.command };
      }
    }
  }
  return null;
}
