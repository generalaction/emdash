import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  HEAD_MODE,
  toRangeString,
  toRefString,
  type Branch,
  type Commit,
  type CommitError,
  type CommitFile,
  type CreateBranchError,
  type DeleteBranchError,
  type DiffLine,
  type DiffMode,
  type DiffResult,
  type FetchError,
  type FetchPrForReviewError,
  type FullGitStatus,
  type GitChange,
  type GitHeadState,
  type GitInfo,
  type GitObjectRef,
  type GitStatusFingerprint,
  type GitStatusUntrackedMode,
  type ImageReadResult,
  type LocalBranch,
  type MergeBaseRange,
  type PullError,
  type PushError,
  type RemoteBranch,
  type RenameBranchError,
  type SoftResetError,
} from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { parseGitHubRepository } from '@shared/github-repository';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { HookCore } from '@main/lib/hookable';
import type { IDisposable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { type GitProvider } from '../types';
import type { WorkspaceGitHooks } from '../workspace-git-provider';
import { CatFileBatch } from './cat-file-batch';
import {
  computeBaseRef,
  mapStatus,
  MAX_DIFF_CONTENT_BYTES,
  MAX_DIFF_OUTPUT_BYTES,
  MAX_REF_LIST_BYTES,
  parseDiffLines,
  stripTrailingNewline,
} from './git-utils';
import {
  MAX_STATUS_FILES,
  StatusParser,
  TooManyFilesChangedError,
  type IFileStatus,
} from './status-parser';

const MAX_IMAGE_BLOB_BYTES = 10 * 1024 * 1024;
const STATUS_FINGERPRINT_TIMEOUT_MS: Record<GitStatusUntrackedMode, number> = {
  no: 5_000,
  normal: 10_000,
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

function imageMimeForPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? (IMAGE_MIME_BY_EXT[ext] ?? null) : null;
}

const LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/');

// Without an LFS smudge filter, cat-file returns pointer text instead of image bytes.
function looksLikeLfsPointer(buffer: Buffer): boolean {
  if (buffer.length > 1024) return false;
  return buffer.slice(0, LFS_POINTER_PREFIX.length).equals(LFS_POINTER_PREFIX);
}

type HeadInfo =
  | { kind: 'branch'; name: string }
  | { kind: 'detached'; shortHash: string }
  | { kind: 'unborn'; name: string };

type SubmoduleInfo = {
  rootPath: string;
};

type ResolvedSubmodulePath = SubmoduleInfo & {
  innerPath: string;
};

type SubmodulePointerChange = {
  rootPath: string;
  oldOid: string;
  newOid: string;
};

export class GitService implements GitProvider, IDisposable {
  private _statusInFlight: Promise<FullGitStatus> | null = null;
  private _catFile: CatFileBatch | null = null;
  private readonly _hooks = new HookCore<WorkspaceGitHooks>((name, e) =>
    log.error(`GitService: ${String(name)} hook error`, e)
  );

  constructor(
    private readonly ctx: IExecutionContext,
    private readonly authCtx: IExecutionContext,
    private readonly fs: FileSystemProvider
  ) {}

  on<K extends keyof WorkspaceGitHooks>(name: K, handler: WorkspaceGitHooks[K]) {
    return this._hooks.on(name, handler);
  }

  dispose(): void {
    this._catFile?.dispose();
    this._catFile = null;
  }

  private _getCatFile(): CatFileBatch | null {
    if (!this.ctx.supportsLocalSpawn) return null;
    this._catFile ??= new CatFileBatch(this.ctx.root ?? '');
    return this._catFile;
  }

  private parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const l of stdout
      .trim()
      .split('\n')
      .filter((s) => s.trim())) {
      const [addStr, delStr, ...pathParts] = l.split('\t');
      const filePath = pathParts.join('\t');
      if (!filePath) continue;
      const existing = map.get(filePath) ?? { additions: 0, deletions: 0 };
      existing.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
      existing.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
      map.set(filePath, existing);
    }
    return map;
  }

  private async _getSubmodules(): Promise<SubmoduleInfo[]> {
    try {
      const { stdout } = await this.ctx.exec('git', ['submodule', 'status', '--recursive']);
      return stdout
        .split('\n')
        .map((line) => {
          const match = line.match(/^([ +-U]?)[0-9a-f]{40}\s+([^\s(]+)/);
          if (!match || match[1] === '-') return '';
          return match[2]?.replace(/\\/g, '/').replace(/\/+$/g, '') ?? '';
        })
        .filter((rootPath): rootPath is string => rootPath.length > 0)
        .sort((a, b) => b.length - a.length)
        .map((rootPath) => ({ rootPath }));
    } catch {
      return [];
    }
  }

  private _resolveSubmodulePath(
    filePath: string,
    submodules: SubmoduleInfo[]
  ): ResolvedSubmodulePath | null {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/g, '');
    for (const submodule of submodules) {
      if (normalized === submodule.rootPath) {
        return { ...submodule, innerPath: '' };
      }
      const prefix = `${submodule.rootPath}/`;
      if (normalized.startsWith(prefix)) {
        return { ...submodule, innerPath: normalized.slice(prefix.length) };
      }
    }
    return null;
  }

  private async _resolveSubmodule(filePath: string): Promise<ResolvedSubmodulePath | null> {
    return this._resolveSubmodulePath(filePath, await this._getSubmodules());
  }

  private _withSubmodulePrefix(change: GitChange, rootPath: string): GitChange {
    const innerPath = change.path.replace(/\\/g, '/').replace(/^\/+/g, '');
    return {
      ...change,
      path: `${rootPath}/${innerPath}`,
      submodule: { rootPath, path: innerPath },
    };
  }

  private _coalesceChanges(changes: GitChange[]): GitChange[] {
    const byPath = new Map<string, GitChange>();
    for (const change of changes) {
      const existing = byPath.get(change.path);
      if (!existing) {
        byPath.set(change.path, { ...change });
        continue;
      }
      byPath.set(change.path, {
        ...existing,
        status: change.status === 'conflicted' ? 'conflicted' : existing.status,
        additions: existing.additions + change.additions,
        deletions: existing.deletions + change.deletions,
        submodule: existing.submodule ?? change.submodule,
      });
    }
    return [...byPath.values()];
  }

  async getFullStatus(): Promise<FullGitStatus> {
    if (this._statusInFlight) return this._statusInFlight;
    this._statusInFlight = this._loadFullStatus()
      .then((status) => {
        this._hooks.callHookBackground('status:updated', status);
        return status;
      })
      .finally(() => {
        this._statusInFlight = null;
      });
    return this._statusInFlight;
  }

  async getStatusFingerprint(untracked: GitStatusUntrackedMode): Promise<GitStatusFingerprint> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), STATUS_FINGERPRINT_TIMEOUT_MS[untracked]);

    try {
      const { stdout } = await this.ctx.exec(
        'git',
        [
          '--no-optional-locks',
          'status',
          '--porcelain=v1',
          '-z',
          untracked === 'normal' ? '--untracked-files=normal' : '-uno',
        ],
        { signal: abort.signal }
      );
      return {
        hash: createHash('sha256').update(stdout).digest('hex'),
        byteLength: Buffer.byteLength(stdout),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async isFileCleanlyTracked(filePath: string): Promise<boolean> {
    try {
      await this.ctx.exec('git', ['ls-files', '--error-unmatch', '--', filePath]);
      await this.ctx.exec('git', ['diff', '--quiet', '--', filePath]);
      await this.ctx.exec('git', ['diff', '--cached', '--quiet', '--', filePath]);
      return true;
    } catch {
      return false;
    }
  }

  private async _loadFullStatus(): Promise<FullGitStatus> {
    try {
      const parser = new StatusParser();
      const [, stagedRes, unstagedRes, head, submodules] = await Promise.all([
        this._runStatusZ(parser),
        this.ctx.exec('git', ['diff', '--numstat', '--cached']).catch(() => ({
          stdout: '',
        })),
        this.ctx.exec('git', ['diff', '--numstat']).catch(() => ({ stdout: '' })),
        this._getHeadInfo(),
        this._getSubmodules(),
      ]);

      const stagedNumstat = this.parseNumstat(stagedRes.stdout);
      const unstagedNumstat = this.parseNumstat(unstagedRes.stdout);

      if (parser.status.length > MAX_STATUS_FILES || parser.tooManyFiles) {
        throw new TooManyFilesChangedError();
      }

      const status = await this._buildFullGitStatus(
        parser.status,
        stagedNumstat,
        unstagedNumstat,
        head
      );
      return await this._expandSubmoduleStatus(status, submodules);
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) throw e;
      return {
        staged: [],
        unstaged: [],
        currentBranch: null,
        headKind: 'branch',
        shortHash: null,
        totalAdded: 0,
        totalDeleted: 0,
      };
    }
  }

  private async _runStatusZ(parser: StatusParser): Promise<void> {
    await this.ctx.execStreaming(
      'git',
      ['--no-optional-locks', 'status', '-z', '-uall'],
      (chunk) => {
        parser.update(chunk);
        return !parser.tooManyFiles;
      }
    );
    if (parser.tooManyFiles) throw new TooManyFilesChangedError();
  }

  private async _buildFullGitStatus(
    entries: IFileStatus[],
    stagedNumstat: Map<string, { additions: number; deletions: number }>,
    unstagedNumstat: Map<string, { additions: number; deletions: number }>,
    head: HeadInfo
  ): Promise<FullGitStatus> {
    const staged: GitChange[] = [];
    const unstaged: GitChange[] = [];

    for (const e of entries) {
      const code = `${e.x}${e.y}`;
      const filePath = e.path;
      const status = mapStatus(code);

      if (e.x !== ' ' && e.x !== '?') {
        const ns = stagedNumstat.get(filePath);
        staged.push({
          path: filePath,
          status,
          additions: ns?.additions ?? 0,
          deletions: ns?.deletions ?? 0,
        });
      }

      const isUntracked = code === '??';
      const hasUnstaged = code[1] !== ' ' && code[1] !== '?';
      if (!isUntracked && !hasUnstaged) {
        continue;
      }

      let additions = unstagedNumstat.get(filePath)?.additions ?? 0;
      const deletions = unstagedNumstat.get(filePath)?.deletions ?? 0;

      if (additions === 0 && deletions === 0 && code.includes('?')) {
        try {
          const result = await this.fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
          if (!result.truncated) {
            additions = (result.content.match(/\n/g) ?? []).length;
          }
        } catch {}
      }

      unstaged.push({
        path: filePath,
        status,
        additions,
        deletions,
      });
    }

    const totalAdded = staged.reduce((s, c) => s + c.additions, 0);
    const totalDeleted = staged.reduce((s, c) => s + c.deletions, 0);

    return {
      staged,
      unstaged,
      currentBranch: head.kind === 'detached' ? null : head.name,
      headKind: head.kind,
      shortHash: head.kind === 'detached' ? head.shortHash : null,
      totalAdded,
      totalDeleted,
    };
  }

  private async _expandSubmoduleStatus(
    status: FullGitStatus,
    submodules: SubmoduleInfo[]
  ): Promise<FullGitStatus> {
    if (submodules.length === 0) return status;

    const [nestedStatus, stagedPointers, unstagedPointers] = await Promise.all([
      this._getNestedSubmoduleStatus(submodules),
      this._getSubmodulePointerChanges(submodules, 'staged'),
      this._getSubmodulePointerChanges(submodules, 'unstaged'),
    ]);

    const [stagedPointerChanges, unstagedPointerChanges] = await Promise.all([
      this._expandSubmodulePointerChanges(stagedPointers),
      this._expandSubmodulePointerChanges(unstagedPointers),
    ]);

    const replacedStagedRoots = new Set([
      ...nestedStatus.staged.map((change) => change.submodule!.rootPath),
      ...stagedPointerChanges.map((change) => change.submodule!.rootPath),
    ]);
    const replacedUnstagedRoots = new Set([
      ...nestedStatus.unstaged.map((change) => change.submodule!.rootPath),
      ...unstagedPointerChanges.map((change) => change.submodule!.rootPath),
    ]);

    const staged = this._coalesceChanges([
      ...status.staged.filter((change) => !replacedStagedRoots.has(change.path)),
      ...stagedPointerChanges,
      ...nestedStatus.staged,
    ]);
    const unstaged = this._coalesceChanges([
      ...status.unstaged.filter((change) => !replacedUnstagedRoots.has(change.path)),
      ...unstagedPointerChanges,
      ...nestedStatus.unstaged,
    ]);

    return {
      ...status,
      staged,
      unstaged,
      totalAdded: staged.reduce((sum, change) => sum + change.additions, 0),
      totalDeleted: staged.reduce((sum, change) => sum + change.deletions, 0),
    };
  }

  private async _getNestedSubmoduleStatus(
    submodules: SubmoduleInfo[]
  ): Promise<{ staged: GitChange[]; unstaged: GitChange[] }> {
    const staged: GitChange[] = [];
    const unstaged: GitChange[] = [];

    for (const submodule of submodules) {
      try {
        const parser = new StatusParser();
        await this.ctx.execStreaming(
          'git',
          ['-C', submodule.rootPath, '--no-optional-locks', 'status', '-z', '-uall'],
          (chunk) => {
            parser.update(chunk);
            return !parser.tooManyFiles;
          }
        );
        if (parser.tooManyFiles) throw new TooManyFilesChangedError();

        const [stagedRes, unstagedRes] = await Promise.all([
          this.ctx
            .exec('git', ['-C', submodule.rootPath, 'diff', '--numstat', '--cached'])
            .catch(() => ({ stdout: '' })),
          this.ctx
            .exec('git', ['-C', submodule.rootPath, 'diff', '--numstat'])
            .catch(() => ({ stdout: '' })),
        ]);
        const stagedNumstat = this.parseNumstat(stagedRes.stdout);
        const unstagedNumstat = this.parseNumstat(unstagedRes.stdout);

        for (const entry of parser.status) {
          const code = `${entry.x}${entry.y}`;
          const status = mapStatus(code);
          const innerPath = entry.path;

          if (entry.x !== ' ' && entry.x !== '?') {
            const ns = stagedNumstat.get(innerPath);
            staged.push(
              this._withSubmodulePrefix(
                {
                  path: innerPath,
                  status,
                  additions: ns?.additions ?? 0,
                  deletions: ns?.deletions ?? 0,
                },
                submodule.rootPath
              )
            );
          }

          const isUntracked = code === '??';
          const hasUnstaged = code[1] !== ' ' && code[1] !== '?';
          if (!isUntracked && !hasUnstaged) continue;

          let additions = unstagedNumstat.get(innerPath)?.additions ?? 0;
          const deletions = unstagedNumstat.get(innerPath)?.deletions ?? 0;

          if (additions === 0 && deletions === 0 && code.includes('?')) {
            try {
              const result = await this.fs.read(
                `${submodule.rootPath}/${innerPath}`,
                MAX_DIFF_CONTENT_BYTES
              );
              if (!result.truncated) additions = (result.content.match(/\n/g) ?? []).length;
            } catch {}
          }

          unstaged.push(
            this._withSubmodulePrefix(
              {
                path: innerPath,
                status,
                additions,
                deletions,
              },
              submodule.rootPath
            )
          );
        }
      } catch (error) {
        if (error instanceof TooManyFilesChangedError) throw error;
      }
    }

    return { staged, unstaged };
  }

  private async _getGitlinkOidAtRef(rootPath: string, ref: string): Promise<string | null> {
    try {
      const { stdout } = await this.ctx.exec('git', ['rev-parse', `${ref}:${rootPath}`]);
      const oid = stdout.trim();
      return oid && oid !== '0'.repeat(40) ? oid : null;
    } catch {
      return null;
    }
  }

  private async _getGitlinkOidAtIndex(rootPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.ctx.exec('git', ['ls-files', '-s', '--', rootPath]);
      const oid = stdout.trim().split(/\s+/)[1] ?? '';
      return oid && oid !== '0'.repeat(40) ? oid : null;
    } catch {
      return null;
    }
  }

  private async _getSubmoduleHeadOid(rootPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.ctx.exec('git', ['-C', rootPath, 'rev-parse', 'HEAD']);
      const oid = stdout.trim();
      return oid && oid !== '0'.repeat(40) ? oid : null;
    } catch {
      return null;
    }
  }

  private async _getSubmodulePointerChanges(
    submodules: SubmoduleInfo[],
    target: 'staged' | 'unstaged'
  ): Promise<SubmodulePointerChange[]> {
    const changes: SubmodulePointerChange[] = [];

    for (const submodule of submodules) {
      const oldOid =
        target === 'staged'
          ? await this._getGitlinkOidAtRef(submodule.rootPath, 'HEAD')
          : await this._getGitlinkOidAtIndex(submodule.rootPath);
      const newOid =
        target === 'staged'
          ? await this._getGitlinkOidAtIndex(submodule.rootPath)
          : await this._getSubmoduleHeadOid(submodule.rootPath);

      if (!oldOid || !newOid || oldOid === newOid) continue;
      changes.push({ rootPath: submodule.rootPath, oldOid, newOid });
    }

    return changes;
  }

  private async _expandSubmodulePointerChanges(
    pointerChanges: SubmodulePointerChange[]
  ): Promise<GitChange[]> {
    const changes: GitChange[] = [];

    for (const pointer of pointerChanges) {
      try {
        const [numstatResult, nameStatusResult] = await Promise.all([
          this.ctx
            .exec('git', [
              '-C',
              pointer.rootPath,
              'diff',
              '--numstat',
              pointer.oldOid,
              pointer.newOid,
            ])
            .catch(() => ({ stdout: '' })),
          this.ctx
            .exec('git', [
              '-C',
              pointer.rootPath,
              'diff',
              '--name-status',
              pointer.oldOid,
              pointer.newOid,
            ])
            .catch(() => ({ stdout: '' })),
        ]);
        const numstatMap = this.parseNumstat(numstatResult.stdout);
        const expanded: GitChange[] = [];

        for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
          const parts = line.split('\t');
          const code = parts[0] ?? '';
          const innerPath = (parts[parts.length - 1] ?? '').trim();
          if (!innerPath) continue;
          const stat = numstatMap.get(innerPath);
          expanded.push(
            this._withSubmodulePrefix(
              {
                path: innerPath,
                status: mapStatus(code),
                additions: stat?.additions ?? 0,
                deletions: stat?.deletions ?? 0,
              },
              pointer.rootPath
            )
          );
        }

        if (expanded.length > 0) {
          changes.push(...expanded);
        } else {
          changes.push({
            path: pointer.rootPath,
            status: 'modified',
            additions: 1,
            deletions: 1,
            submodule: { rootPath: pointer.rootPath, path: '' },
          });
        }
      } catch {
        changes.push({
          path: pointer.rootPath,
          status: 'modified',
          additions: 1,
          deletions: 1,
          submodule: { rootPath: pointer.rootPath, path: '' },
        });
      }
    }

    return changes;
  }

  async getStatus(): Promise<{ changes: GitChange[]; currentBranch: string | null }> {
    try {
      const full = await this.getFullStatus();
      const byPath = new Map<string, GitChange>();
      for (const c of full.staged) {
        byPath.set(c.path, { ...c });
      }
      for (const c of full.unstaged) {
        const prev = byPath.get(c.path);
        if (prev) {
          byPath.set(c.path, {
            path: c.path,
            status: c.status,
            additions: prev.additions + c.additions,
            deletions: prev.deletions + c.deletions,
          });
        } else {
          byPath.set(c.path, c);
        }
      }
      return { changes: [...byPath.values()], currentBranch: full.currentBranch };
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) throw e;
      return { changes: [], currentBranch: null };
    }
  }

  async getStagedChanges(): Promise<{
    changes: GitChange[];
    totalAdded: number;
    totalDeleted: number;
  }> {
    try {
      const full = await this.getFullStatus();
      return {
        changes: full.staged,
        totalAdded: full.totalAdded,
        totalDeleted: full.totalDeleted,
      };
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) {
        return { changes: [], totalAdded: 0, totalDeleted: 0 };
      }
      throw e;
    }
  }

  async getUnstagedChanges(): Promise<{ changes: GitChange[] }> {
    try {
      const full = await this.getFullStatus();
      return { changes: full.unstaged };
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) {
        return { changes: [] };
      }
      throw e;
    }
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const submodules = await this._getSubmodules();
    const parentPaths: string[] = [];
    const bySubmodule = new Map<string, string[]>();

    for (const filePath of filePaths) {
      const submodule = this._resolveSubmodulePath(filePath, submodules);
      if (!submodule || !submodule.innerPath) {
        parentPaths.push(filePath);
        continue;
      }
      bySubmodule.set(submodule.rootPath, [
        ...(bySubmodule.get(submodule.rootPath) ?? []),
        submodule.innerPath,
      ]);
    }

    for (const [rootPath, innerPaths] of bySubmodule) {
      await this.ctx.exec('git', ['-C', rootPath, 'add', '--', ...innerPaths]);
      parentPaths.push(rootPath);
    }

    if (parentPaths.length > 0) {
      await this.ctx.exec('git', ['add', '--', ...[...new Set(parentPaths)]]);
    }
  }

  async stageAllFiles(): Promise<void> {
    for (const submodule of await this._getSubmodules()) {
      await this.ctx.exec('git', ['-C', submodule.rootPath, 'add', '-A']).catch(() => {});
    }
    await this.ctx.exec('git', ['add', '-A']);
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const submodules = await this._getSubmodules();
    const parentPaths: string[] = [];
    const bySubmodule = new Map<string, string[]>();

    for (const filePath of filePaths) {
      const submodule = this._resolveSubmodulePath(filePath, submodules);
      if (!submodule || !submodule.innerPath) {
        parentPaths.push(filePath);
        continue;
      }
      bySubmodule.set(submodule.rootPath, [
        ...(bySubmodule.get(submodule.rootPath) ?? []),
        submodule.innerPath,
      ]);
      parentPaths.push(submodule.rootPath);
    }

    for (const [rootPath, innerPaths] of bySubmodule) {
      await this.ctx
        .exec('git', ['-C', rootPath, 'reset', 'HEAD', '--', ...innerPaths])
        .catch(async () => {
          for (const innerPath of innerPaths) {
            await this.ctx
              .exec('git', ['-C', rootPath, 'reset', 'HEAD', '--', innerPath])
              .catch(() =>
                this.ctx.exec('git', ['-C', rootPath, 'rm', '--cached', '--', innerPath])
              );
          }
        });
    }

    if (parentPaths.length === 0) return;
    try {
      await this.ctx.exec('git', ['reset', 'HEAD', '--', ...[...new Set(parentPaths)]]);
    } catch {
      // Fallback for edge cases (e.g. new files with no HEAD): unstage each via rm --cached
      for (const filePath of [...new Set(parentPaths)]) {
        try {
          await this.ctx.exec('git', ['reset', 'HEAD', '--', filePath]);
        } catch {
          await this.ctx.exec('git', ['rm', '--cached', '--', filePath]);
        }
      }
    }
  }

  async unstageAllFiles(): Promise<void> {
    for (const submodule of await this._getSubmodules()) {
      await this.ctx.exec('git', ['-C', submodule.rootPath, 'reset', 'HEAD']).catch(() => {});
    }
    try {
      await this.ctx.exec('git', ['reset', 'HEAD']);
    } catch {
      // Repo may have no commits yet; ignore.
    }
  }

  async revertFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const submodules = await this._getSubmodules();
    const parentPaths: string[] = [];
    const bySubmodule = new Map<string, string[]>();

    for (const filePath of filePaths) {
      const submodule = this._resolveSubmodulePath(filePath, submodules);
      if (!submodule || !submodule.innerPath) {
        parentPaths.push(filePath);
        continue;
      }
      bySubmodule.set(submodule.rootPath, [
        ...(bySubmodule.get(submodule.rootPath) ?? []),
        submodule.innerPath,
      ]);
      parentPaths.push(submodule.rootPath);
    }

    for (const [rootPath, innerPaths] of bySubmodule) {
      try {
        await this.ctx.exec('git', ['-C', rootPath, 'checkout', 'HEAD', '--', ...innerPaths]);
      } catch {}
      for (const innerPath of innerPaths) {
        try {
          const exists = await this.fs.exists(`${rootPath}/${innerPath}`);
          if (exists) {
            await this.ctx
              .exec('git', ['-C', rootPath, 'ls-files', '--error-unmatch', '--', innerPath])
              .catch(async () => {
                await this.fs.remove(`${rootPath}/${innerPath}`);
              });
          }
        } catch {}
      }
      await this.ctx
        .exec('git', ['submodule', 'update', '--checkout', '--', rootPath])
        .catch(() => {});
    }

    if (parentPaths.length === 0) return;

    // Determine which files exist in HEAD in a single command
    let trackedPaths = new Set<string>();
    try {
      const { stdout } = await this.ctx.exec('git', [
        'ls-tree',
        '--name-only',
        'HEAD',
        '--',
        ...[...new Set(parentPaths)],
      ]);
      trackedPaths = new Set(stdout.trim().split('\n').filter(Boolean));
    } catch {
      // Empty repo — no HEAD yet, all files are untracked
    }

    const tracked = [...new Set(parentPaths)].filter((f) => trackedPaths.has(f));
    const untracked = [...new Set(parentPaths)].filter((f) => !trackedPaths.has(f));

    if (tracked.length > 0) {
      await this.ctx.exec('git', ['checkout', 'HEAD', '--', ...tracked]);
    }

    // Untracked files don't exist in git history — remove them from disk
    for (const filePath of untracked) {
      try {
        const exists = await this.fs.exists(filePath);
        if (exists) await this.fs.remove(filePath);
      } catch {}
    }
  }

  async revertAllFiles(): Promise<void> {
    for (const submodule of await this._getSubmodules()) {
      await this.ctx
        .exec('git', ['-C', submodule.rootPath, 'reset', '--hard', 'HEAD'])
        .catch(() => {});
      await this.ctx.exec('git', ['-C', submodule.rootPath, 'clean', '-fd']).catch(() => {});
    }
    // Reset index and working tree for all tracked changes back to HEAD,
    // then remove any untracked files/directories.
    try {
      await this.ctx.exec('git', ['reset', '--hard', 'HEAD']);
    } catch {
      // Repo may have no commits yet; ignore.
    }
    await this.ctx.exec('git', ['clean', '-fd']);
  }

  // ---------------------------------------------------------------------------
  // Diffs
  // ---------------------------------------------------------------------------

  async getFileAtHead(filePath: string): Promise<string | null> {
    return this.getFileAtRef(filePath, 'HEAD');
  }

  private async _getFileAtSubmoduleCommit(
    rootPath: string,
    innerPath: string,
    oid: string | null
  ): Promise<string | null> {
    if (!innerPath || !oid) return null;
    try {
      const { stdout } = await this.ctx.exec(
        'git',
        ['-C', rootPath, 'show', `${oid}:${innerPath}`],
        {
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        }
      );
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    const submodule = await this._resolveSubmodule(filePath);
    if (submodule?.innerPath) {
      const oid = await this._getGitlinkOidAtRef(submodule.rootPath, ref);
      const fromParentRef = await this._getFileAtSubmoduleCommit(
        submodule.rootPath,
        submodule.innerPath,
        oid
      );
      if (fromParentRef !== null) return fromParentRef;

      try {
        const { stdout } = await this.ctx.exec(
          'git',
          ['-C', submodule.rootPath, 'show', `${ref}:${submodule.innerPath}`],
          { maxBuffer: MAX_DIFF_CONTENT_BYTES }
        );
        return stripTrailingNewline(stdout);
      } catch {
        return null;
      }
    }

    const cf = this._getCatFile();
    if (cf) {
      try {
        return await cf.read(`${ref}:${filePath}`);
      } catch {
        // Batch channel failed — fall back to one-shot git show.
      }
    }
    try {
      const { stdout } = await this.ctx.exec('git', ['show', `${ref}:${filePath}`], {
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getFileAtIndex(filePath: string): Promise<string | null> {
    const submodule = await this._resolveSubmodule(filePath);
    if (submodule?.innerPath) {
      const [headOid, indexOid] = await Promise.all([
        this._getGitlinkOidAtRef(submodule.rootPath, 'HEAD'),
        this._getGitlinkOidAtIndex(submodule.rootPath),
      ]);

      if (indexOid && indexOid !== headOid) {
        return this._getFileAtSubmoduleCommit(submodule.rootPath, submodule.innerPath, indexOid);
      }

      try {
        const { stdout } = await this.ctx.exec(
          'git',
          ['-C', submodule.rootPath, 'show', `:0:${submodule.innerPath}`],
          { maxBuffer: MAX_DIFF_CONTENT_BYTES }
        );
        return stripTrailingNewline(stdout);
      } catch {
        return null;
      }
    }

    const cf = this._getCatFile();
    if (cf) {
      try {
        return await cf.read(`:0:${filePath}`);
      } catch {
        // Fall back
      }
    }
    try {
      const { stdout } = await this.ctx.exec('git', ['show', `:0:${filePath}`], {
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult> {
    const submodule = await this._resolveSubmodule(filePath);
    if (submodule?.innerPath) {
      const oid = await this._getGitlinkOidAtRef(submodule.rootPath, ref);
      if (oid) {
        return this._readImageBlob(`${oid}:${submodule.innerPath}`, filePath, submodule.rootPath);
      }
    }
    return this._readImageBlob(`${ref}:${filePath}`, filePath);
  }

  async getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    const submodule = await this._resolveSubmodule(filePath);
    if (submodule?.innerPath) {
      const [headOid, indexOid] = await Promise.all([
        this._getGitlinkOidAtRef(submodule.rootPath, 'HEAD'),
        this._getGitlinkOidAtIndex(submodule.rootPath),
      ]);
      if (indexOid && indexOid !== headOid) {
        return this._readImageBlob(
          `${indexOid}:${submodule.innerPath}`,
          filePath,
          submodule.rootPath
        );
      }
      return this._readImageBlob(`:0:${submodule.innerPath}`, filePath, submodule.rootPath);
    }
    return this._readImageBlob(`:0:${filePath}`, filePath);
  }

  // SSH workspaces have no binary-safe exec channel.
  private async _readImageBlob(
    spec: string,
    filePath: string,
    cwd?: string
  ): Promise<ImageReadResult> {
    if (!this.ctx.supportsLocalSpawn) return { kind: 'unavailable', reason: 'ssh' };
    const mimeType = imageMimeForPath(filePath);
    if (!mimeType) return { kind: 'unavailable', reason: 'unsupported' };

    return new Promise((resolve) => {
      const child = spawn(GIT_EXECUTABLE, ['cat-file', '--filters', spec], {
        cwd: cwd ? path.join(this.ctx.root ?? '', cwd) : this.ctx.root || undefined,
      });
      const chunks: Buffer[] = [];
      let total = 0;
      let aborted = false;

      child.stdout.on('data', (chunk: Buffer) => {
        if (aborted) return;
        total += chunk.length;
        if (total > MAX_IMAGE_BLOB_BYTES) {
          aborted = true;
          child.kill();
          resolve({ kind: 'unavailable', reason: 'too-large' });
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.resume();
      child.on('error', () => resolve({ kind: 'unavailable', reason: 'git-error' }));
      child.on('close', (code) => {
        if (aborted) return;
        if (code !== 0) {
          resolve(
            code === 128 ? { kind: 'missing' } : { kind: 'unavailable', reason: 'git-error' }
          );
          return;
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          resolve({ kind: 'unavailable', reason: 'git-error' });
          return;
        }
        if (looksLikeLfsPointer(buffer)) {
          resolve({ kind: 'unavailable', reason: 'lfs-pointer' });
          return;
        }
        resolve({
          kind: 'image',
          image: {
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
            mimeType,
            size: buffer.length,
          },
        });
      });
    });
  }

  async getFileDiff(
    filePath: string,
    base: DiffMode | GitObjectRef = HEAD_MODE
  ): Promise<DiffResult> {
    const diffArgs = (() => {
      switch (base.kind) {
        case 'staged':
          return ['diff', '--no-color', '--unified=2000', '--cached', '--', filePath];
        case 'head':
          return ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath];
        default:
          return [
            'diff',
            '--no-color',
            '--unified=2000',
            `${toRefString(base)}...HEAD`,
            '--',
            filePath,
          ];
      }
    })();

    const isObjectRef = base.kind !== 'head' && base.kind !== 'staged';

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.ctx.exec('git', diffArgs, {
        maxBuffer: MAX_DIFF_OUTPUT_BYTES,
      });
      diffStdout = stdout;
    } catch {}

    const originalRef = isObjectRef ? toRefString(base as GitObjectRef) : 'HEAD';

    const getOriginalContent = async (): Promise<string | undefined> => {
      try {
        const { stdout } = await this.ctx.exec('git', ['show', `${originalRef}:${filePath}`], {
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    const getModifiedContent = async (): Promise<string | undefined> => {
      if (isObjectRef) {
        try {
          const { stdout } = await this.ctx.exec('git', ['show', `HEAD:${filePath}`], {
            maxBuffer: MAX_DIFF_CONTENT_BYTES,
          });
          return stripTrailingNewline(stdout);
        } catch {
          return undefined;
        }
      }
      try {
        const result = await this.fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
        if (result.truncated) return undefined;
        return stripTrailingNewline(result.content);
      } catch {
        return undefined;
      }
    };

    if (diffStdout !== undefined) {
      const { lines, isBinary } = parseDiffLines(diffStdout);
      if (isBinary) return { lines: [], isBinary: true };

      const [originalContent, modifiedContent] = await Promise.all([
        getOriginalContent(),
        getModifiedContent(),
      ]);

      if (lines.length === 0) {
        if (modifiedContent !== undefined) {
          return {
            lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
            modifiedContent,
          };
        }
        if (originalContent !== undefined) {
          return {
            lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
            originalContent,
          };
        }
        return { lines: [] };
      }
      return { lines, originalContent, modifiedContent };
    }

    const [originalContent, modifiedContent] = await Promise.all([
      getOriginalContent(),
      getModifiedContent(),
    ]);

    if (modifiedContent !== undefined) {
      return {
        lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
        originalContent,
        modifiedContent,
      };
    }
    if (originalContent !== undefined) {
      return {
        lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
        originalContent,
      };
    }
    return { lines: [] };
  }

  async getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
    const getContentAt = async (ref: string): Promise<string | undefined> => {
      try {
        const { stdout } = await this.ctx.exec('git', ['show', `${ref}:${filePath}`], {
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    let hasParent = true;
    try {
      await this.ctx.exec('git', ['rev-parse', '--verify', `${commitHash}~1`]);
    } catch {
      hasParent = false;
    }

    if (!hasParent) {
      const modifiedContent = await getContentAt(commitHash);
      if (modifiedContent === undefined) return { lines: [] };
      if (modifiedContent === '') return { lines: [], modifiedContent };
      return {
        lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
        modifiedContent,
      };
    }

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(
        'git',
        ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
        { maxBuffer: MAX_DIFF_OUTPUT_BYTES }
      );
      diffStdout = stdout;
    } catch {}

    let diffLines: DiffLine[] = [];
    if (diffStdout !== undefined) {
      const { lines, isBinary } = parseDiffLines(diffStdout);
      if (isBinary) return { lines: [], isBinary: true };
      diffLines = lines;
    }

    const [originalContent, modifiedContent] = await Promise.all([
      getContentAt(`${commitHash}~1`),
      getContentAt(commitHash),
    ]);

    if (diffLines.length > 0) return { lines: diffLines, originalContent, modifiedContent };

    if (modifiedContent !== undefined && modifiedContent !== '') {
      return {
        lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
        originalContent,
        modifiedContent,
      };
    }
    if (originalContent !== undefined) {
      return {
        lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
        originalContent,
        modifiedContent,
      };
    }
    return { lines: [], originalContent, modifiedContent };
  }

  // ---------------------------------------------------------------------------
  // Commit log
  // ---------------------------------------------------------------------------

  async getLog(options?: {
    maxCount?: number;
    skip?: number;
    knownAheadCount?: number;
    preferredRemote?: string;
    /**
     * When provided, compute aheadCount as `base..<head|HEAD>` instead of
     * `@{upstream}..HEAD`. Use an immutable commit SHA for merged PRs so the
     * count remains stable after the remote base branch moves forward.
     */
    base?: GitObjectRef;
    /**
     * When provided, anchor the log and aheadCount range to this ref instead
     * of the live HEAD. Pass `commitRef(pr.headRefOid)` for merged PRs.
     */
    head?: GitObjectRef;
  }): Promise<{ commits: Commit[]; aheadCount: number }> {
    const { maxCount = 50, skip = 0, knownAheadCount, preferredRemote, base, head } = options ?? {};
    const remote = preferredRemote?.trim() || DEFAULT_REMOTE_NAME;
    const headStr = head ? toRefString(head) : 'HEAD';

    let aheadCount = knownAheadCount ?? -1;
    if (aheadCount < 0) {
      aheadCount = 0;

      if (base !== undefined) {
        // PR-relative count: compare explicitly against the PR base ref.
        try {
          const { stdout } = await this.ctx.exec('git', [
            'rev-list',
            '--count',
            `${toRefString(base)}..${headStr}`,
          ]);
          aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
        } catch {
          aheadCount = 0;
        }
      } else {
        try {
          const { stdout } = await this.ctx.exec('git', [
            'rev-list',
            '--count',
            '@{upstream}..HEAD',
          ]);
          aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
        } catch {
          try {
            const { stdout: branchOut } = await this.ctx.exec('git', [
              'rev-parse',
              '--abbrev-ref',
              'HEAD',
            ]);
            const currentBranch = branchOut.trim();
            const { stdout } = await this.ctx.exec('git', [
              'rev-list',
              '--count',
              `${remote}/${currentBranch}..HEAD`,
            ]);
            aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
          } catch {
            try {
              const { stdout: defaultBranchOut } = await this.ctx.exec('git', [
                'symbolic-ref',
                '--short',
                `refs/remotes/${remote}/HEAD`,
              ]);
              const defaultBranch = defaultBranchOut.trim();
              const { stdout } = await this.ctx.exec('git', [
                'rev-list',
                '--count',
                `${defaultBranch}..HEAD`,
              ]);
              aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
            } catch {
              aheadCount = 0;
            }
          }
        }
      }
    }

    const FIELD_SEP = '---FIELD_SEP---';
    const RECORD_SEP = '---RECORD_SEP---';
    const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%b`;
    // When base is provided (PR view), use a range so only commits between
    // base and head are returned — not a raw linear walk from head.
    const rangeArg = base ? `${toRefString(base)}..${headStr}` : headStr;
    const { stdout } = await this.ctx.exec('git', [
      'log',
      `--max-count=${maxCount}`,
      `--skip=${skip}`,
      `--pretty=format:${format}`,
      rangeArg,
      '--',
    ]);

    if (!stdout.trim()) return { commits: [], aheadCount };

    const commits = stdout
      .split(RECORD_SEP)
      .filter((entry) => entry.trim())
      .map((entry, index) => {
        const parts = entry.trim().split(FIELD_SEP);
        const refs = parts[4] || '';
        const tags = refs
          .split(',')
          .map((r) => r.trim())
          .filter((r) => r.startsWith('tag: '))
          .map((r) => r.slice(5));
        return {
          hash: parts[0] || '',
          subject: parts[1] || '',
          body: (parts[5] || '').trim(),
          author: parts[2] || '',
          date: parts[3] || '',
          isPushed: skip + index >= aheadCount,
          tags,
        };
      });

    return { commits, aheadCount };
  }

  async getLatestCommit(): Promise<Commit | null> {
    const { commits } = await this.getLog({ maxCount: 1 });
    return commits[0] || null;
  }

  async getChangedFiles(base: DiffMode | GitObjectRef | MergeBaseRange): Promise<GitChange[]> {
    const isRange = 'base' in base;
    const isStaged = !isRange && (base as DiffMode | GitObjectRef).kind === 'staged';
    const ref = isStaged
      ? '--cached'
      : isRange
        ? toRangeString(base as MergeBaseRange)
        : toRefString(base as GitObjectRef);

    const parseNumstat = (
      stdout: string
    ): Map<string, { additions: number; deletions: number }> => {
      const map = new Map<string, { additions: number; deletions: number }>();
      for (const l of stdout
        .trim()
        .split('\n')
        .filter((s) => s.trim())) {
        const [addStr, delStr, ...pathParts] = l.split('\t');
        const filePath = pathParts.join('\t');
        if (!filePath) continue;
        const existing = map.get(filePath) ?? { additions: 0, deletions: 0 };
        existing.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
        existing.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
        map.set(filePath, existing);
      }
      return map;
    };

    const diffArgs = isStaged ? ['diff', '--numstat', '--cached'] : ['diff', '--numstat', ref];
    const nameArgs = isStaged
      ? ['diff', '--name-status', '--cached']
      : ['diff', '--name-status', ref];

    const [numstatResult, nameStatusResult] = await Promise.all([
      this.ctx.exec('git', diffArgs).catch(() => ({ stdout: '' })),
      this.ctx.exec('git', nameArgs).catch(() => ({ stdout: '' })),
    ]);

    const numstatMap = parseNumstat(numstatResult.stdout);
    const submodules = await this._getSubmodules();
    const submoduleRoots = new Set(submodules.map((submodule) => submodule.rootPath));
    const rawPointerChanges = await this._getRawSubmodulePointerChanges(ref, submoduleRoots);
    const pointerChanges = await this._expandSubmodulePointerChanges(rawPointerChanges);
    const expandedRoots = new Set(pointerChanges.map((change) => change.submodule!.rootPath));

    const changes: GitChange[] = [];
    for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const code = parts[0] ?? '';
      const filePath = (parts[parts.length - 1] ?? '').trim();
      if (!filePath) continue;
      if (expandedRoots.has(filePath)) continue;

      const stat = numstatMap.get(filePath);
      changes.push({
        path: filePath,
        status: mapStatus(code),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      });
    }

    return this._coalesceChanges([...changes, ...pointerChanges]);
  }

  private async _getRawSubmodulePointerChanges(
    ref: string,
    submoduleRoots: Set<string>
  ): Promise<SubmodulePointerChange[]> {
    if (submoduleRoots.size === 0) return [];
    const args =
      ref === '--cached'
        ? ['diff', '--raw', '--cached', '--', ...submoduleRoots]
        : ['diff', '--raw', ref, '--', ...submoduleRoots];

    try {
      const { stdout } = await this.ctx.exec('git', args);
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((line): SubmodulePointerChange[] => {
          const match = line.match(
            /^:160000\s+160000\s+([0-9a-f]{7,40})\s+([0-9a-f]{7,40})\s+\S+\s+(.+)$/
          );
          if (!match) return [];
          const rootPath = match[3]!.trim();
          if (!submoduleRoots.has(rootPath)) return [];
          const oldOid = match[1]!;
          const newOid = match[2]!;
          if (/^0+$/.test(oldOid) || /^0+$/.test(newOid) || oldOid === newOid) return [];
          return [{ rootPath, oldOid, newOid }];
        });
    } catch {
      return [];
    }
  }

  async getCommitFiles(commitHash: string): Promise<CommitFile[]> {
    const { stdout } = await this.ctx.exec('git', [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-m',
      '--first-parent',
      '--numstat',
      commitHash,
    ]);

    const { stdout: nameStatus } = await this.ctx.exec('git', [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-m',
      '--first-parent',
      '--name-status',
      commitHash,
    ]);

    const statLines = stdout.trim().split('\n').filter(Boolean);
    const statusLines = nameStatus.trim().split('\n').filter(Boolean);

    const statusMap = new Map<string, string>();
    for (const line of statusLines) {
      const [code, ...pathParts] = line.split('\t');
      const filePath = pathParts[pathParts.length - 1] || '';
      statusMap.set(filePath, mapStatus(code ?? ''));
    }

    return statLines.map((line) => {
      const [addStr, delStr, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      return {
        path: filePath,
        status: statusMap.get(filePath) || 'modified',
        additions: addStr === '-' ? 0 : Number.parseInt(addStr || '0', 10) || 0,
        deletions: delStr === '-' ? 0 : Number.parseInt(delStr || '0', 10) || 0,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  private async _hasStagedChanges(rootPath: string): Promise<boolean> {
    try {
      await this.ctx.exec('git', ['-C', rootPath, 'diff', '--cached', '--quiet']);
      return false;
    } catch {
      return true;
    }
  }

  private async _commitStagedSubmodules(message: string): Promise<Result<void, CommitError>> {
    const submodules = await this._getSubmodules();

    for (const submodule of submodules) {
      const hasStagedChanges = await this._hasStagedChanges(submodule.rootPath);
      if (!hasStagedChanges) continue;

      try {
        await this.ctx.exec('git', ['-C', submodule.rootPath, 'commit', '-m', message]);
      } catch (error: unknown) {
        const stderr = (error as { stderr?: string })?.stderr || '';
        const stdout = (error as { stdout?: string })?.stdout || '';
        const output = stderr || stdout || String(error);
        if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
          continue;
        }
        return err({ type: 'hook_failed', message: output });
      }

      try {
        const parent = this._findParentSubmodule(submodule.rootPath, submodules);
        if (parent) {
          const relativePath = submodule.rootPath.slice(parent.rootPath.length + 1);
          await this.ctx.exec('git', ['-C', parent.rootPath, 'add', '--', relativePath]);
        } else {
          await this.ctx.exec('git', ['add', '--', submodule.rootPath]);
        }
      } catch (error: unknown) {
        return err({ type: 'error', message: String(error) });
      }
    }

    return ok(undefined);
  }

  private _findParentSubmodule(
    rootPath: string,
    submodules: SubmoduleInfo[]
  ): SubmoduleInfo | null {
    return (
      submodules
        .filter((candidate) => rootPath.startsWith(`${candidate.rootPath}/`))
        .sort((a, b) => b.rootPath.length - a.rootPath.length)[0] ?? null
    );
  }

  async commit(message: string): Promise<Result<{ hash: string }, CommitError>> {
    if (!message || !message.trim()) return err({ type: 'empty_message' });
    const submoduleCommit = await this._commitStagedSubmodules(message);
    if (!submoduleCommit.success) return err(submoduleCommit.error);

    try {
      await this.ctx.exec('git', ['commit', '-m', message]);
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || '';
      const stdout = (error as { stdout?: string })?.stdout || '';
      const output = stderr || stdout || String(error);
      if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
        return err({ type: 'nothing_to_commit' });
      }
      return err({ type: 'hook_failed', message: output });
    }
    try {
      const { stdout } = await this.ctx.exec('git', ['rev-parse', 'HEAD']);
      return ok({ hash: stdout.trim() });
    } catch (error: unknown) {
      return err({ type: 'error', message: String(error) });
    }
  }

  async fetch(remote?: string): Promise<Result<void, FetchError>> {
    try {
      const remotes = await this.ctx.exec('git', ['remote']).catch(() => ({
        stdout: '',
      }));
      const remoteNames = remotes.stdout
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean);
      if (remoteNames.length === 0) return err({ type: 'no_remote' });

      const selectedRemote = remote?.trim();
      if (selectedRemote && !remoteNames.includes(selectedRemote)) {
        return err({ type: 'remote_not_found', message: `Remote "${selectedRemote}" not found` });
      }

      await this.authCtx.exec('git', selectedRemote ? ['fetch', selectedRemote] : ['fetch'], {
        maxBuffer: MAX_REF_LIST_BYTES,
      });
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message: stderr });
      }
      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message: stderr });
      }
      if (
        stderr.includes('does not appear to be a git repository') ||
        stderr.includes('repository not found') ||
        stderr.includes('Repository not found') ||
        stderr.includes('not found') ||
        stderr.includes('ERROR: Repository not found')
      ) {
        return err({ type: 'remote_not_found', message: stderr });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  async push(preferredRemote?: string): Promise<Result<{ output: string }, PushError>> {
    const doPush = async (args: string[]): Promise<string> => {
      const { stdout, stderr } = await this.authCtx.exec('git', args);
      return (stdout || stderr || '').trim();
    };

    try {
      const submodulePush = await this._pushSubmodules();
      if (!submodulePush.success) return err(submodulePush.error);

      const remote = preferredRemote?.trim();
      if (remote) {
        const { stdout } = await this.ctx.exec('git', ['branch', '--show-current']);
        const currentBranch = stdout.trim();
        if (!currentBranch) {
          return err({ type: 'error', message: 'No branch checked out' });
        }
        const output = await doPush(['push', remote, `HEAD:${currentBranch}`]);
        return ok({ output });
      }
      const output = await doPush(['push']);
      return ok({ output });
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stderr.includes('Everything up-to-date') || message.includes('Everything up-to-date')) {
        return ok({ output: 'Everything up-to-date' });
      }

      if (
        stderr.includes('has no upstream branch') ||
        stderr.includes('no upstream configured') ||
        stderr.includes('upstream branch of your current branch does not match')
      ) {
        try {
          const { stdout: branchOut } = await this.ctx.exec('git', ['branch', '--show-current']);
          const currentBranch = branchOut.trim();
          const pushRemote = preferredRemote?.trim() || DEFAULT_REMOTE_NAME;
          const output = await doPush(['push', '--set-upstream', pushRemote, currentBranch]);
          return ok({ output });
        } catch (upstreamError: unknown) {
          const upstreamStderr = (upstreamError as { stderr?: string })?.stderr || '';
          return err({ type: 'error', message: upstreamStderr || String(upstreamError) });
        }
      }

      if (
        stderr.includes('[rejected]') ||
        stderr.includes('Updates were rejected') ||
        stderr.includes('non-fast-forward')
      ) {
        return err({ type: 'rejected', message });
      }

      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message });
      }

      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message });
      }

      if (stderr.includes('hook declined') || stderr.includes('pre-receive hook')) {
        return err({ type: 'hook_rejected', message });
      }

      if (stderr.includes('No configured push destination') || stderr.includes('no remote')) {
        return err({ type: 'no_remote', message });
      }

      return err({ type: 'error', message });
    }
  }

  private async _pushSubmodules(): Promise<Result<void, PushError>> {
    for (const submodule of await this._getSubmodules()) {
      try {
        const { stdout } = await this.authCtx.exec('git', [
          '-C',
          submodule.rootPath,
          'rev-list',
          '--count',
          '@{upstream}..HEAD',
        ]);
        const ahead = Number.parseInt(stdout.trim(), 10) || 0;
        if (ahead === 0) continue;
        await this.authCtx.exec('git', ['-C', submodule.rootPath, 'push']);
      } catch (error: unknown) {
        const stderr = (error as { stderr?: string })?.stderr || '';
        const message = stderr || String(error);
        if (
          stderr.includes('no upstream configured') ||
          stderr.includes('has no upstream branch') ||
          stderr.includes('no upstream') ||
          stderr.includes('No configured push destination')
        ) {
          const remoteContainsHead = await this._isSubmoduleHeadOnAnyRemote(submodule.rootPath);
          if (remoteContainsHead) continue;
          return err({
            type: 'no_remote',
            message: `Submodule "${submodule.rootPath}" has commits that need to be pushed, but no upstream is configured.`,
          });
        }
        if (
          stderr.includes('Authentication failed') ||
          stderr.includes('authentication failed') ||
          stderr.includes('Permission denied') ||
          stderr.includes('could not read Username')
        ) {
          return err({ type: 'auth_failed', message });
        }
        if (
          stderr.includes('Could not resolve host') ||
          stderr.includes('could not resolve host') ||
          stderr.includes('Network is unreachable') ||
          stderr.includes('Connection refused') ||
          stderr.includes('Connection timed out') ||
          stderr.includes('unable to connect')
        ) {
          return err({ type: 'network_error', message });
        }
        return err({
          type: 'error',
          message: `Failed to push submodule "${submodule.rootPath}": ${message}`,
        });
      }
    }
    return ok(undefined);
  }

  private async _isSubmoduleHeadOnAnyRemote(rootPath: string): Promise<boolean> {
    try {
      const { stdout } = await this.ctx.exec('git', [
        '-C',
        rootPath,
        'branch',
        '-r',
        '--contains',
        'HEAD',
      ]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async publishBranch(
    branchName: string,
    remote = 'origin'
  ): Promise<Result<{ output: string }, PushError>> {
    const doPush = async (args: string[]): Promise<string> => {
      const { stdout, stderr } = await this.authCtx.exec('git', args);
      return (stdout || stderr || '').trim();
    };

    try {
      const output = await doPush(['push', '--set-upstream', remote, branchName]);
      return ok({ output });
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stderr.includes('Everything up-to-date') || message.includes('Everything up-to-date')) {
        return ok({ output: 'Everything up-to-date' });
      }

      if (
        stderr.includes('[rejected]') ||
        stderr.includes('Updates were rejected') ||
        stderr.includes('non-fast-forward')
      ) {
        try {
          await this.ctx.exec('git', [
            'branch',
            `--set-upstream-to=${remote}/${branchName}`,
            branchName,
          ]);
        } catch {}
        return err({ type: 'rejected', message });
      }

      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message });
      }

      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message });
      }

      if (stderr.includes('hook declined') || stderr.includes('pre-receive hook')) {
        return err({ type: 'hook_rejected', message });
      }

      if (
        stderr.includes('No configured push destination') ||
        stderr.includes('no remote') ||
        stderr.includes('does not appear to be a git repository')
      ) {
        return err({ type: 'no_remote', message });
      }

      return err({ type: 'error', message });
    }
  }

  async pull(): Promise<Result<{ output: string }, PullError>> {
    try {
      const { stdout } = await this.authCtx.exec('git', ['pull']);
      return ok({ output: stdout.trim() });
    } catch (error: unknown) {
      const stdout = (error as { stdout?: string })?.stdout || '';
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stdout.includes('CONFLICT') || stderr.includes('CONFLICT')) {
        let conflictedFiles: string[] = [];
        try {
          const { stdout: conflictOut } = await this.ctx.exec('git', [
            'diff',
            '--name-only',
            '--diff-filter=U',
          ]);
          conflictedFiles = conflictOut
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);
        } catch {}
        return err({ type: 'conflict', conflictedFiles, message });
      }

      if (
        stderr.includes('There is no tracking information') ||
        stderr.includes('no tracking information') ||
        stderr.includes('has no upstream branch') ||
        stderr.includes('no upstream configured')
      ) {
        return err({ type: 'no_upstream', message });
      }

      if (
        stderr.includes('Need to specify how to reconcile') ||
        stderr.includes('hint: You have divergent branches') ||
        stderr.includes('fatal: Need to specify how to reconcile')
      ) {
        return err({ type: 'diverged', message });
      }

      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message });
      }

      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message });
      }

      return err({ type: 'error', message });
    }
  }

  async softReset(): Promise<Result<{ subject: string; body: string }, SoftResetError>> {
    try {
      await this.ctx.exec('git', ['rev-parse', '--verify', 'HEAD~1']);
    } catch {
      return err({ type: 'initial_commit' });
    }

    const { commits: log } = await this.getLog({ maxCount: 1 });
    if (log[0]?.isPushed) {
      return err({ type: 'already_pushed' });
    }

    try {
      const { stdout: subject } = await this.ctx.exec('git', ['log', '-1', '--pretty=format:%s']);
      const { stdout: body } = await this.ctx.exec('git', ['log', '-1', '--pretty=format:%b']);

      await this.ctx.exec('git', ['reset', '--soft', 'HEAD~1']);

      return ok({ subject: subject.trim(), body: body.trim() });
    } catch (error: unknown) {
      return err({ type: 'error', message: String(error) });
    }
  }

  async getCurrentBranch(): Promise<string | null> {
    const head = await this._getHeadInfo();
    return head.kind === 'detached' ? null : head.name;
  }

  private async _getHeadInfo(): Promise<HeadInfo> {
    try {
      const { stdout } = await this.ctx.exec('git', ['rev-parse', '--symbolic-full-name', 'HEAD']);
      const ref = stdout.trim();
      if (ref === 'HEAD' || !ref) {
        // Detached HEAD — also capture the short commit hash for display
        try {
          const { stdout: hashOut } = await this.ctx.exec('git', ['rev-parse', '--short', 'HEAD']);
          return { kind: 'detached', shortHash: hashOut.trim() };
        } catch {
          return { kind: 'detached', shortHash: '' };
        }
      }
      if (ref.startsWith('refs/heads/'))
        return { kind: 'branch', name: ref.slice('refs/heads/'.length) };
      if (ref.startsWith('heads/')) return { kind: 'branch', name: ref.slice('heads/'.length) };
      return { kind: 'branch', name: ref };
    } catch {
      // Unborn branch — rev-parse fails but symbolic-ref still resolves
      try {
        const { stdout: symOut } = await this.ctx.exec('git', ['symbolic-ref', '--short', 'HEAD']);
        return { kind: 'unborn', name: symOut.trim() };
      } catch {
        return { kind: 'unborn', name: 'main' };
      }
    }
  }

  async getWorktreeGitDir(mainDotGitAbs: string): Promise<string> {
    try {
      const { stdout } = await this.ctx.exec('git', ['rev-parse', '--git-dir']);
      const raw = stdout.trim();
      const root = this.ctx.root ?? '';
      const gitDirAbs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
      const rel = path.relative(mainDotGitAbs, gitDirAbs).replace(/\\/g, '/');
      return rel === '.' || rel === '' ? '' : rel;
    } catch {
      return `worktrees/${path.basename(this.ctx.root ?? '')}`;
    }
  }

  async getBranches(): Promise<Branch[]> {
    const remotes = await this.getRemotes();
    const remoteByName = new Map(remotes.map((remote) => [remote.name, remote]));
    const { stdout } = await this.ctx.exec(
      'git',
      ['branch', '-a', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(refname)'],
      { maxBuffer: MAX_REF_LIST_BYTES }
    );

    const branches: Branch[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [refname, upstreamRef, track, fullRef] = trimmed.split('|');

      if (fullRef?.startsWith('refs/remotes/')) {
        const withoutPrefix = fullRef.slice('refs/remotes/'.length);
        if (withoutPrefix.includes('HEAD')) continue;
        const slashIdx = withoutPrefix.indexOf('/');
        const remoteName = slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
        const branchName = slashIdx === -1 ? '' : withoutPrefix.slice(slashIdx + 1);
        const entry: RemoteBranch = {
          type: 'remote',
          branch: branchName,
          remote: remoteByName.get(remoteName) ?? { name: remoteName, url: '' },
        };
        branches.push(entry);
      } else {
        const localBranchName = fullRef?.startsWith('refs/heads/')
          ? fullRef.slice('refs/heads/'.length)
          : refname;
        const entry: LocalBranch = { type: 'local', branch: localBranchName };
        if (upstreamRef) {
          const slashIdx = upstreamRef.indexOf('/');
          const remoteName = slashIdx === -1 ? upstreamRef : upstreamRef.slice(0, slashIdx);
          entry.remote = remoteByName.get(remoteName) ?? { name: remoteName, url: '' };
          if (track) {
            const ahead = Number.parseInt(/ahead (\d+)/.exec(track)?.[1] ?? '0', 10);
            const behind = Number.parseInt(/behind (\d+)/.exec(track)?.[1] ?? '0', 10);
            entry.divergence = { ahead, behind };
          }
        }
        branches.push(entry);
      }
    }

    return branches;
  }

  async getDefaultBranch(remote = 'origin'): Promise<string> {
    // Heuristic 1: ask the remote what its HEAD points to (fast, no network call needed
    // because git caches this in refs/remotes/<remote>/HEAD after a fetch/clone).
    try {
      const { stdout } = await this.ctx.exec('git', [
        'symbolic-ref',
        `refs/remotes/${remote}/HEAD`,
        '--short',
      ]);
      const ref = stdout.trim();
      if (ref) {
        const slashIdx = ref.indexOf('/');
        return slashIdx === -1 ? ref : ref.slice(slashIdx + 1);
      }
    } catch {}

    // Heuristic 2: ask the remote directly (requires a network call).
    try {
      const { stdout } = await this.authCtx.exec('git', ['remote', 'show', remote]);
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1]) return match[1];
    } catch {}

    // Heuristic 3: fall back to well-known default branch names in preference order.
    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      if (await this._branchExistsLocally(candidate)) return candidate;
    }

    // Last resort: return "main" as a convention.
    return 'main';
  }

  private async _branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.ctx.exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    try {
      const { stdout } = await this.ctx.exec('git', ['remote', '-v']);
      const seen = new Set<string>();
      const remotes: { name: string; url: string }[] = [];
      for (const line of stdout.split('\n')) {
        const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
        if (match?.[1] && match[2] && !seen.has(match[1])) {
          seen.add(match[1]);
          remotes.push({ name: match[1], url: match[2] });
        }
      }
      return remotes;
    } catch {
      return [];
    }
  }

  async getHeadState(): Promise<GitHeadState> {
    let headName: string | undefined;
    try {
      const { stdout } = await this.ctx.exec('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
      headName = stdout.trim() || undefined;
    } catch {}

    try {
      await this.ctx.exec('git', ['rev-parse', '--verify', 'HEAD']);
      return { headName, isUnborn: false };
    } catch {
      return { headName, isUnborn: true };
    }
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.ctx.exec('git', ['remote', 'add', name, url]);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote = true,
    remote = 'origin'
  ): Promise<Result<void, CreateBranchError>> {
    if (syncWithRemote) {
      await this.authCtx
        .exec('git', ['fetch', remote], {
          maxBuffer: MAX_REF_LIST_BYTES,
        })
        .catch(() => {});
    }
    const base = syncWithRemote ? `${remote}/${from}` : `refs/heads/${from}`;
    try {
      await this.ctx.exec('git', ['branch', '--no-track', name, base]);
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('already exists')) {
        return err({ type: 'already_exists', name });
      }
      if (
        stderr.includes('not a valid object name') ||
        stderr.includes('Not a valid object name') ||
        stderr.includes('invalid reference')
      ) {
        return err({ type: 'invalid_base', from });
      }
      if (
        stderr.includes('not a valid branch name') ||
        stderr.includes('invalid branch name') ||
        stderr.includes("'.' is not a valid branch name")
      ) {
        return err({ type: 'invalid_name', name });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    configuredRemote = 'origin'
  ): Promise<Result<void, FetchPrForReviewError>> {
    try {
      if (isFork) {
        const forkRemote = parseGitHubRepository(headRepositoryUrl)?.owner ?? 'fork';
        // Idempotently ensure remote exists with the correct URL
        const remotes = await this.ctx.exec('git', ['remote']).catch(() => ({ stdout: '' }));
        const names = remotes.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!names.includes(forkRemote)) {
          await this.ctx.exec('git', ['remote', 'add', forkRemote, headRepositoryUrl]);
        } else {
          await this.ctx
            .exec('git', ['remote', 'set-url', forkRemote, headRepositoryUrl])
            .catch(() => {});
        }
        await this.authCtx.exec('git', [
          'fetch',
          forkRemote,
          `${headRefName}:refs/heads/${localBranch}`,
          '--force',
        ]);
        // Set tracking so `git push` targets the contributor's fork branch
        await this.ctx
          .exec('git', ['branch', `--set-upstream-to=${forkRemote}/${headRefName}`, localBranch])
          .catch(() => {});
      } else {
        // Same-repo: GitHub always exposes refs/pull/{N}/head on origin
        await this.authCtx.exec('git', [
          'fetch',
          configuredRemote,
          `refs/pull/${prNumber}/head:refs/heads/${localBranch}`,
          '--force',
        ]);
        await this.ctx
          .exec('git', [
            'branch',
            `--set-upstream-to=${configuredRemote}/${headRefName}`,
            localBranch,
          ])
          .catch(() => {});
      }
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr ?? String(error);
      if (
        stderr.includes('not found') ||
        stderr.includes("couldn't find remote ref") ||
        stderr.includes('unknown revision')
      ) {
        return err({ type: 'not_found', prNumber });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  async renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ remotePushed: boolean }, RenameBranchError>> {
    let remoteName: string | undefined;
    try {
      const { stdout } = await this.ctx.exec('git', [
        'config',
        '--get',
        `branch.${oldBranch}.remote`,
      ]);
      remoteName = stdout.trim() || undefined;
    } catch {}

    try {
      await this.ctx.exec('git', ['branch', '-m', oldBranch, newBranch]);
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('already exists')) {
        return err({ type: 'already_exists', name: newBranch });
      }
      return err({ type: 'error', message: stderr });
    }

    if (remoteName) {
      try {
        await this.authCtx.exec('git', ['push', remoteName, '--delete', oldBranch]);
      } catch {}
      try {
        await this.authCtx.exec('git', ['push', '-u', remoteName, newBranch]);
      } catch (error: unknown) {
        const stderr = (error as { stderr?: string })?.stderr || String(error);
        return err({ type: 'remote_push_failed', message: stderr });
      }
    }

    return ok({ remotePushed: !!remoteName });
  }

  async deleteBranch(branch: string, force = true): Promise<Result<void, DeleteBranchError>> {
    const flag = force ? '-D' : '-d';
    try {
      await this.ctx.exec('git', ['branch', flag, branch]);
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('not fully merged')) {
        return err({ type: 'unmerged', branch });
      }
      if (stderr.includes('not found') || stderr.includes('did not match any branch')) {
        return err({ type: 'not_found', branch });
      }
      if (stderr.includes('checked out') || stderr.includes('is not fully merged')) {
        return err({ type: 'is_current', branch });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  // ---------------------------------------------------------------------------
  // Repo info
  // ---------------------------------------------------------------------------

  async detectInfo(): Promise<GitInfo> {
    try {
      await this.ctx.exec('git', ['rev-parse', '--is-inside-work-tree']);
    } catch {
      return { isGitRepo: false, baseRef: 'main', rootPath: this.ctx.root ?? '' };
    }

    let remoteName: string | undefined;
    try {
      const { stdout } = await this.ctx.exec('git', ['remote']);
      const remotes = stdout.trim().split('\n').filter(Boolean);
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch {}

    let branch: string | undefined;
    try {
      const { stdout } = await this.ctx.exec('git', ['branch', '--show-current']);
      branch = stdout.trim() || undefined;
    } catch {}

    if (!branch && remoteName) {
      try {
        const { stdout } = await this.authCtx.exec('git', ['remote', 'show', remoteName]);
        const match = /HEAD branch:\s*(\S+)/.exec(stdout);
        branch = match?.[1] ?? undefined;
      } catch {}
    }

    let rootPath: string = this.ctx.root ?? '';
    try {
      const { stdout } = await this.ctx.exec('git', ['rev-parse', '--show-toplevel']);
      const trimmed = stdout.trim();
      if (trimmed) rootPath = trimmed;
    } catch {}

    return {
      isGitRepo: true,
      baseRef: computeBaseRef(undefined, remoteName, branch),
      rootPath,
    };
  }

  async initRepository(): Promise<void> {
    await this.ctx.exec('git', ['init']);
  }
}
