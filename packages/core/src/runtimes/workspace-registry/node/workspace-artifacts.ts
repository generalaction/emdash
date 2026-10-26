import { promises as fs } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { EMDASH_CONFIG_FILE } from '#primitives/emdash-config/api';
import {
  absoluteEquals,
  containsAbsolute,
  formatAbsolute,
  joinAbsolute,
  parseNativeAbsolute,
  relativeSegmentsFromAbsolute,
  type HostAbsolutePath,
} from '#primitives/path/api';
import { defaultGitExecFactory, type GitExecFactory } from '#services/exec/node/git-exec';
import type { MeasureUsageError } from '../api/errors';
import { resolvePreservedEntries } from './preserve-patterns';

/** Why a workspace's artifacts could not be listed or removed. */
export type WorkspaceArtifactsError = Exclude<MeasureUsageError, { type: 'workspace-not-found' }>;

export type WorkspaceArtifactsOptions = {
  /** Absolute native path, as stored on the registry record. */
  workspacePath: string;
  /** The project's resolved preserve patterns: the ignored files it deliberately keeps. */
  preservePatterns: readonly string[];
  /**
   * Absolute paths of the other registered workspaces inside this one. Git skips nested
   * repositories and worktrees on its own, but not a plain directory workspace.
   */
  nestedWorkspacePaths: readonly string[];
  signal?: AbortSignal;
  createGitExec?: GitExecFactory;
};

/**
 * Ignored files that are user-authored local config, often secrets nobody can restore,
 * rather than regenerable output: never artifacts, whatever the preserve patterns say.
 * They reach git as negated excludes, so `git clean` neither lists them nor removes a
 * directory that holds one. Git cannot re-include a file below a directory that is
 * ignored as a whole, so such a directory stays one artifact; preserve it to keep it.
 */
const LOCAL_ENV_PATTERNS = ['.env', '.env.*'] as const;

/**
 * The one definition of a workspace's artifacts: what `measureUsage` reports as
 * reclaimable and `cleanArtifacts` removes. They are the git-ignored roots
 * `git clean -ndX` lists, which never include tracked files, untracked files that
 * are not ignored, local env files, or nested repositories and worktrees. A root is
 * not an artifact when it is, contains, or lies inside an entry the project preserves,
 * another registered workspace, or emdash's own `.emdash.json`, so none of them is
 * ever removed alongside its siblings. Returns workspace-relative POSIX paths.
 */
export async function listWorkspaceArtifacts(
  options: WorkspaceArtifactsOptions
): Promise<Result<string[], WorkspaceArtifactsError>> {
  const ignored = await listIgnoredRoots(options);
  if (!ignored.success) return ignored;
  let preserved: string[];
  try {
    preserved = (await resolvePreservedEntries(options.workspacePath, options.preservePatterns))
      .entries;
  } catch (error) {
    options.signal?.throwIfAborted();
    return err({
      type: 'filesystem-error',
      message: `Could not resolve preserve patterns: ${errorMessage(error)}`,
    });
  }
  const kept = [
    ...preserved,
    ...nestedWorkspaceEntries(options.workspacePath, options.nestedWorkspacePaths),
    EMDASH_CONFIG_FILE,
  ];
  return ok(ignored.data.filter((root) => !kept.some((entry) => pathsOverlap(root, entry))));
}

/** The nested workspaces as workspace-relative POSIX paths; anything not inside is dropped. */
function nestedWorkspaceEntries(
  workspacePath: string,
  nestedWorkspacePaths: readonly string[]
): string[] {
  const root = parseNativeAbsolute(path.resolve(workspacePath));
  if (!root.success) return [];
  return nestedWorkspacePaths.flatMap((nestedPath) => {
    const nested = parseNativeAbsolute(path.resolve(nestedPath));
    const segments = nested.success && relativeSegmentsFromAbsolute(root.data, nested.data);
    return segments && segments.success && segments.data.length > 0
      ? [segments.data.join('/')]
      : [];
  });
}

/**
 * Removes the workspace's artifacts in place. Deletion does not trust its listing:
 * each target must resolve strictly inside the workspace, or it is skipped and
 * reported (see {@link removalTarget}). One root failing does not stop the others;
 * failures are reported once every root was attempted.
 */
export async function removeWorkspaceArtifacts(
  options: WorkspaceArtifactsOptions
): Promise<Result<void, WorkspaceArtifactsError>> {
  const artifacts = await listWorkspaceArtifacts(options);
  if (!artifacts.success) return artifacts;
  const root = await workspaceRoot(options.workspacePath);
  if (!root.success) return root;

  const skipped: string[] = [];
  const failures: string[] = [];
  for (const artifact of artifacts.data) {
    try {
      const target = await removalTarget(root.data, artifact);
      if (target.kind === 'outside') skipped.push(artifact);
      else if (target.kind === 'remove') {
        await fs.rm(target.path, { recursive: true, force: true });
      }
    } catch (error) {
      failures.push(`${artifact}: ${errorMessage(error)}`);
    }
  }
  if (skipped.length > 0) {
    return err({
      type: 'unsafe-artifact-path',
      message:
        `Skipped ${skipped.length} artifacts that resolve outside the workspace ` +
        `(first: ${skipped[0]}).` +
        (failures.length > 0 ? ` ${removalFailureMessage(failures, artifacts.data)}` : ''),
    });
  }
  if (failures.length > 0) {
    return err({
      type: 'filesystem-error',
      message: removalFailureMessage(failures, artifacts.data),
    });
  }
  return ok(undefined);
}

type RemovalTarget = { kind: 'remove'; path: string } | { kind: 'outside' } | { kind: 'gone' };

type WorkspaceRoot = {
  /** The workspace path as registered. */
  path: HostAbsolutePath;
  /** The same directory with every symbolic link resolved. */
  realPath: HostAbsolutePath;
};

async function workspaceRoot(
  workspacePath: string
): Promise<Result<WorkspaceRoot, WorkspaceArtifactsError>> {
  try {
    const parsed = parseNativeAbsolute(path.resolve(workspacePath));
    const real = parseNativeAbsolute(await fs.realpath(workspacePath));
    if (!parsed.success) return err({ type: 'filesystem-error', message: parsed.error.message });
    if (!real.success) return err({ type: 'filesystem-error', message: real.error.message });
    return ok({ path: parsed.data, realPath: real.data });
  } catch (error) {
    return err({ type: 'filesystem-error', message: errorMessage(error) });
  }
}

/**
 * The absolute path to remove for one artifact, or why there is none. The artifact
 * must join onto the workspace without escaping it and name something strictly inside
 * it, never the workspace itself; its parent directory must also resolve inside the
 * workspace's real path, so a symlinked ancestor cannot redirect the removal. `fs.rm`
 * unlinks a symlinked target itself rather than following it.
 */
async function removalTarget(root: WorkspaceRoot, artifact: string): Promise<RemovalTarget> {
  const target = artifactPath(root.path, artifact);
  if (!target) return { kind: 'outside' };
  const formatted = formatAbsolute(target);
  let parent: string;
  try {
    parent = await fs.realpath(path.dirname(formatted));
  } catch (error) {
    // Nothing to remove when the artifact's directory is already gone.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'gone' };
    throw error;
  }
  const realParent = parseNativeAbsolute(parent);
  return realParent.success && containsAbsolute(root.realPath, realParent.data)
    ? { kind: 'remove', path: formatted }
    : { kind: 'outside' };
}

/** The artifact's absolute path when it lies strictly inside the workspace root. */
function artifactPath(root: HostAbsolutePath, artifact: string): HostAbsolutePath | undefined {
  const joined = joinAbsolute(root, artifact);
  if (!joined.success) return undefined;
  return containsAbsolute(root, joined.data) && !absoluteEquals(root, joined.data)
    ? joined.data
    : undefined;
}

async function listIgnoredRoots(
  options: WorkspaceArtifactsOptions
): Promise<Result<string[], WorkspaceArtifactsError>> {
  const createGitExec = options.createGitExec ?? defaultGitExecFactory;
  let stdout: string;
  try {
    const result = await createGitExec(options.workspacePath).exec(
      [
        // Quote every name that is not plain ASCII, so the output parses unambiguously.
        '-c',
        'core.quotePath=true',
        'clean',
        '-ndX',
        ...LOCAL_ENV_PATTERNS.flatMap((pattern) => ['-e', `!${pattern}`]),
        '--',
      ],
      options.signal ? { signal: options.signal } : {}
    );
    stdout = result.stdout;
  } catch (error) {
    options.signal?.throwIfAborted();
    return err({ type: 'git-command-failed', message: errorMessage(error) });
  }

  const root = parseNativeAbsolute(path.resolve(options.workspacePath));
  if (!root.success) return err({ type: 'filesystem-error', message: root.error.message });
  const roots: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const relativePath = parseGitCleanDryRunLine(line);
    if (relativePath === undefined) continue;
    if (!artifactPath(root.data, relativePath)) {
      return err({
        type: 'unsafe-artifact-path',
        message: `Ignored artifact escapes workspace: ${relativePath}`,
      });
    }
    roots.push(relativePath);
  }
  return ok(roots);
}

/**
 * One `git clean -n` line to a workspace-relative path; `Would skip repository` lines
 * (nested repositories and worktrees) are not artifacts. Names arrive verbatim or
 * C-quoted; a name that cannot be decoded exactly is left alone.
 */
function parseGitCleanDryRunLine(line: string): string | undefined {
  const prefix = 'Would remove ';
  if (!line.startsWith(prefix)) return undefined;
  const name = unquoteGitPath(line.slice(prefix.length));
  // Directories carry a trailing slash; a file name never ends in one.
  const normalized = name?.replace(/\/$/u, '');
  if (!normalized || normalized === '.' || normalized === '..') return undefined;
  return normalized;
}

const BACKSLASH_BYTE = 0x5c;

/** git's single-character escapes: the letter after the backslash, to its byte. */
const C_ESCAPES: ReadonlyMap<string, number> = new Map([
  ['a', 0x07],
  ['b', 0x08],
  ['t', 0x09],
  ['n', 0x0a],
  ['v', 0x0b],
  ['f', 0x0c],
  ['r', 0x0d],
  ['"', 0x22],
  ['\\', BACKSLASH_BYTE],
]);

/**
 * Undoes git's C-style path quoting: a name with control characters, quotes,
 * backslashes or (with `core.quotePath`) non-ASCII bytes arrives wrapped in double
 * quotes, with backslash and three-digit octal escapes for its bytes. Escapes are
 * ASCII and UTF-8 never encodes a multibyte character with ASCII bytes, so the
 * quoted text is decoded byte by byte. Undefined when the quoting is malformed or the
 * bytes are not UTF-8.
 */
function unquoteGitPath(value: string): string | undefined {
  if (!value.startsWith('"')) return value;
  if (value.length < 2 || !value.endsWith('"')) return undefined;
  const quoted = new TextEncoder().encode(value.slice(1, -1));
  const bytes: number[] = [];
  for (let index = 0; index < quoted.length; index += 1) {
    const byte = quoted[index]!;
    if (byte !== BACKSLASH_BYTE) {
      bytes.push(byte);
      continue;
    }
    const escape = quoted[index + 1];
    if (escape === undefined) return undefined;
    const simple = C_ESCAPES.get(String.fromCharCode(escape));
    if (simple !== undefined) {
      bytes.push(simple);
      index += 1;
      continue;
    }
    const octal = new TextDecoder().decode(quoted.subarray(index + 1, index + 4));
    if (!/^[0-3][0-7]{2}$/u.test(octal)) return undefined;
    bytes.push(Number.parseInt(octal, 8));
    index += 3;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

function removalFailureMessage(failures: string[], artifacts: string[]): string {
  return (
    `Could not remove ${failures.length} of ${artifacts.length} artifacts ` +
    `(first: ${failures[0]}).`
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
