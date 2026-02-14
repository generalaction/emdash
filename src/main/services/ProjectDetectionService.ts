import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { EmdashConfig } from './LifecycleScriptsService';
import { DEFAULT_PRESERVE_PATTERNS } from '@shared/lifecycle';

const execFileAsync = promisify(execFile);

const ENV_FILE_PATTERN = /^\.env(\..*)?$/;

const EXCLUDE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'vendor',
  '.cache',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
]);

const TEMPLATE_PATTERNS = new Set(['.env.example', '.env.sample', '.env.template']);

function detectNodePm(projectPath: string): string {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn';
  // bun.lockb (binary, older) and bun.lock (text, v1.2+)
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock')))
    return 'bun';
  if (existsSync(join(projectPath, 'bunfig.toml'))) return 'bun';
  return 'npm';
}

function detectPythonPm(projectPath: string): string {
  if (existsSync(join(projectPath, 'poetry.lock'))) return 'poetry';
  if (existsSync(join(projectPath, 'Pipfile.lock')) || existsSync(join(projectPath, 'Pipfile')))
    return 'pipenv';
  if (existsSync(join(projectPath, 'uv.lock'))) return 'uv';
  return 'pip';
}

function readPackageJsonScripts(projectPath: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf8'));
    return (pkg.scripts as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

interface DetectionResult {
  setup: string;
  run: string;
  teardown: string;
}

function detectScripts(projectPath: string): DetectionResult {
  if (existsSync(join(projectPath, 'package.json'))) {
    const pm = detectNodePm(projectPath);
    const scripts = readPackageJsonScripts(projectPath);
    const runPrefix = pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun run' : `${pm} run`;
    let run = '';
    if (scripts['dev']) {
      run = `${runPrefix} dev`;
    } else if (scripts['start']) {
      run = `${runPrefix} start`;
    }
    return { setup: `${pm} install`, run, teardown: '' };
  }

  if (
    existsSync(join(projectPath, 'pyproject.toml')) ||
    existsSync(join(projectPath, 'requirements.txt')) ||
    existsSync(join(projectPath, 'Pipfile'))
  ) {
    const pm = detectPythonPm(projectPath);
    const setupMap: Record<string, string> = {
      poetry: 'poetry install',
      pipenv: 'pipenv install',
      uv: 'uv sync',
      pip: 'pip install -r requirements.txt',
    };
    return { setup: setupMap[pm] ?? '', run: '', teardown: '' };
  }

  const simpleProjects: Array<{ marker: string | string[]; setup: string }> = [
    { marker: 'Gemfile', setup: 'bundle install' },
    { marker: 'Cargo.toml', setup: 'cargo build' },
    { marker: 'go.mod', setup: 'go mod download' },
    { marker: ['build.gradle', 'build.gradle.kts'], setup: './gradlew build -x test' },
    { marker: 'pom.xml', setup: 'mvn install -DskipTests' },
    { marker: 'composer.json', setup: 'composer install' },
    { marker: 'mix.exs', setup: 'mix deps.get' },
  ];

  for (const { marker, setup } of simpleProjects) {
    const markers = Array.isArray(marker) ? marker : [marker];
    if (markers.some((m) => existsSync(join(projectPath, m)))) {
      return { setup, run: '', teardown: '' };
    }
  }

  return { setup: '', run: '', teardown: '' };
}

function isEnvFileName(name: string): boolean {
  return ENV_FILE_PATTERN.test(name) || name === '.envrc' || name === 'docker-compose.override.yml';
}

// Git repo → readdir fallback → hardcoded defaults
async function scanEnvFiles(projectPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard'],
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024, timeout: 5000 }
    );

    const envFiles = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (line.length === 0) return false;
        const segments = line.split('/');
        if (segments.some((s) => EXCLUDE_SEGMENTS.has(s))) return false;
        const name = basename(line);
        if (TEMPLATE_PATTERNS.has(name)) return false;
        return isEnvFileName(name);
      });

    if (envFiles.length > 0) {
      return [...new Set(envFiles)];
    }
  } catch {
    // fall through
  }

  try {
    const entries = readdirSync(projectPath, { withFileTypes: true });
    const envFiles = entries.filter((e) => e.isFile() && isEnvFileName(e.name)).map((e) => e.name);

    if (envFiles.length > 0) {
      return envFiles;
    }
  } catch {
    // fall through
  }

  return DEFAULT_PRESERVE_PATTERNS;
}

export async function detectConfig(projectPath: string): Promise<EmdashConfig> {
  const scripts = detectScripts(projectPath);
  const preservePatterns = await scanEnvFiles(projectPath);

  return {
    preservePatterns,
    scripts: {
      setup: scripts.setup,
      run: scripts.run,
      teardown: scripts.teardown,
    },
  };
}
