import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { copyPreservedFilesStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepOk,
  stepWarning,
  type StepCtx,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { stringifyError } from './helpers';

export const copyPreservedFilesImpl = implement(copyPreservedFilesStep, async (_args, ctx) => {
  const targetPath = ctx.resolvedWorktreePath;
  if (!targetPath || ctx.preservePatterns.length === 0) return stepOk();

  const warnings = [];
  for (const pattern of ctx.preservePatterns) {
    if (!isSafePreservePattern(pattern)) {
      warnings.push(
        stepWarning('unsafe-preserve-pattern', `Skipped unsafe preserve pattern "${pattern}"`)
      );
      continue;
    }

    try {
      const sourceFiles = await matchPattern(ctx.repoPath, pattern);
      for (const sourcePath of sourceFiles) {
        const relativePath = toPosixPath(path.relative(ctx.repoPath, sourcePath));
        if (!relativePath || relativePath.startsWith('.git/')) continue;
        if (await isTrackedSourcePath(relativePath, ctx)) continue;

        const targetFilePath = path.resolve(targetPath, relativePath);
        if (!isContainedBy(path.resolve(targetPath), targetFilePath)) {
          warnings.push(
            stepWarning(
              'unsafe-preserve-destination',
              `Skipped preserve destination "${relativePath}"`
            )
          );
          continue;
        }

        await mkdir(path.dirname(targetFilePath), { recursive: true });
        await copyFile(sourcePath, targetFilePath);
      }
    } catch (error) {
      warnings.push(
        stepWarning(
          'copy-preserved-files-failed',
          `Failed to copy preserved files for "${pattern}": ${stringifyError(error)}`
        )
      );
    }
  }

  return stepOk({ warnings });
});

async function isTrackedSourcePath(relativePath: string, ctx: StepCtx): Promise<boolean> {
  const result = await runGit(['ls-files', '--error-unmatch', '--', relativePath], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  return result.success;
}

function isSafePreservePattern(pattern: string): boolean {
  if (!pattern || path.isAbsolute(pattern)) return false;
  return !toPosixPath(pattern)
    .split('/')
    .some((part) => part === '..');
}

async function matchPattern(repoPath: string, pattern: string): Promise<string[]> {
  if (!hasGlob(pattern)) {
    const sourcePath = path.resolve(repoPath, pattern);
    if (!isContainedBy(path.resolve(repoPath), sourcePath)) return [];
    const sourceStat = await stat(sourcePath).catch(() => undefined);
    return sourceStat?.isFile() ? [sourcePath] : [];
  }

  const matcher = globMatcher(pattern);
  const files: string[] = [];
  for await (const filePath of walkFiles(repoPath)) {
    const relativePath = toPosixPath(path.relative(repoPath, filePath));
    if (matcher(relativePath)) files.push(filePath);
  }
  return files;
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function hasGlob(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

function globMatcher(pattern: string): (relativePath: string) => boolean {
  const normalized = toPosixPath(pattern);
  const regexp = new RegExp(`^${globToRegex(normalized)}$`);
  return (relativePath) => regexp.test(relativePath);
}

function globToRegex(pattern: string): string {
  let regex = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      index++;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(char);
    }
  }
  return regex;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function isContainedBy(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
