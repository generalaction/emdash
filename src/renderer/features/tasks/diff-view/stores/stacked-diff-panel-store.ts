import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { commitRef, HEAD_REF, STAGED_REF, type GitChange, type GitObjectRef } from '@shared/git';
import { getPrNumber } from '@shared/pull-requests';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { isBinaryForDiff } from '@renderer/lib/editor/fileKind';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';
import { MAX_STACKED_FILES, type DiffViewStore } from './diff-view-store';
import type { GitStore } from './git-store';

type DiffType = 'disk' | 'staged' | 'git' | 'pr';

interface SlotContext {
  files: GitChange[];
  diffType: DiffType;
  originalRef: GitObjectRef;
  modifiedRef?: GitObjectRef;
}

export class DiffSlotStore {
  file: GitChange | null = null;
  diffType: DiffType = 'disk';
  originalRef: GitObjectRef = commitRef('HEAD');
  modifiedRef: GitObjectRef | undefined = undefined;

  constructor(
    readonly projectId: string,
    readonly workspaceId: string
  ) {
    makeObservable(this, {
      file: observable.ref,
      diffType: observable,
      originalRef: observable.ref,
      modifiedRef: observable.ref,
      uri: computed,
      originalUri: computed,
      modifiedUri: computed,
      language: computed,
      isBinary: computed,
    });
  }

  get uri(): string {
    if (!this.file) return '';
    return buildMonacoModelPath(`workspace:${this.workspaceId}`, this.file.path);
  }

  get originalUri(): string {
    if (!this.uri) return '';
    if (this.diffType === 'git' || this.diffType === 'pr') {
      return modelRegistry.toGitUri(this.uri, this.originalRef);
    }
    return modelRegistry.toGitUri(this.uri, HEAD_REF);
  }

  get modifiedUri(): string {
    if (!this.uri) return '';
    if (this.diffType === 'staged') return modelRegistry.toGitUri(this.uri, STAGED_REF);

    if (this.diffType === 'pr') {
      return modelRegistry.toGitUri(this.uri, this.modifiedRef ?? HEAD_REF);
    }

    if (this.diffType === 'git') {
      return modelRegistry.toGitUri(this.uri, HEAD_REF);
    }

    return this.uri;
  }

  get language(): string {
    return this.file ? getLanguageFromPath(this.file.path) : '';
  }

  get isBinary(): boolean {
    return this.file ? isBinaryForDiff(this.file.path) : false;
  }
}

export class StackedDiffPanelStore {
  private readonly _slots: DiffSlotStore[];

  // _count is private so we include it via the AdditionalKeys type parameter.
  private _count = 0;

  /** Path-keyed expanded state — survives group switches for the same file path. */
  private readonly _expanded = observable.map<string, boolean>();
  /** Path-keyed force-load set for large diffs. */
  private readonly _forceLoad = observable.set<string>();

  private readonly _disposers: Array<() => void> = [];

  constructor(
    projectId: string,
    workspaceId: string,
    private readonly diffView: DiffViewStore,
    private readonly git: GitStore,
    private readonly pr: PrStore
  ) {
    this._slots = Array.from(
      { length: MAX_STACKED_FILES },
      () => new DiffSlotStore(projectId, workspaceId)
    );

    makeObservable<StackedDiffPanelStore, '_count'>(this, {
      _count: observable,
      visibleSlots: computed,
      toggleExpanded: action,
      setForceLoad: action,
    });

    this._disposers.push(
      reaction(
        () => this._currentContext(),
        (ctx) => this._applyContext(ctx),
        { fireImmediately: true }
      )
    );
  }

  get visibleSlots(): DiffSlotStore[] {
    return this._slots.slice(0, this._count);
  }

  isExpanded(path: string): boolean {
    return this._expanded.get(path) ?? true;
  }

  toggleExpanded(path: string): void {
    this._expanded.set(path, !this.isExpanded(path));
  }

  isForceLoaded(path: string): boolean {
    return this._forceLoad.has(path);
  }

  setForceLoad(path: string): void {
    this._forceLoad.add(path);
  }

  dispose(): void {
    for (const d of this._disposers) d();
    this._disposers.length = 0;
  }

  private _currentContext(): SlotContext {
    const activeFile = this.diffView.activeFile;

    if (!activeFile) {
      return { files: [], diffType: 'disk', originalRef: commitRef('HEAD') };
    }

    if (activeFile.group === 'pr') {
      const activePr = this.pr.pullRequests.find(
        (p) => activeFile.prNumber != null && getPrNumber(p) === activeFile.prNumber
      );
      return {
        files: activePr ? (this.pr.getFiles(activePr).data ?? []) : [],
        diffType: 'pr',
        originalRef: activeFile.originalRef,
        modifiedRef: activeFile.modifiedRef,
      };
    }

    if (activeFile.group === 'git') {
      return { files: [], diffType: 'git', originalRef: activeFile.originalRef };
    }

    const isStaged = activeFile.group === 'staged';
    return {
      files: isStaged ? this.git.stagedFileChanges : this.git.unstagedFileChanges,
      diffType: isStaged ? 'staged' : 'disk',
      originalRef: commitRef('HEAD'),
    };
  }

  private _applyContext({ files, diffType, originalRef, modifiedRef }: SlotContext): void {
    const count = Math.min(files.length, MAX_STACKED_FILES);
    this._count = count;

    for (let i = 0; i < count; i++) {
      const slot = this._slots[i]!;
      slot.file = files[i]!;
      slot.diffType = diffType;
      slot.originalRef = originalRef;
      slot.modifiedRef = modifiedRef;
    }

    const currentPaths = new Set(files.map((f) => f.path));
    for (const path of this._expanded.keys()) {
      if (!currentPaths.has(path)) this._expanded.delete(path);
    }
    for (const path of this._forceLoad) {
      if (!currentPaths.has(path)) this._forceLoad.delete(path);
    }
  }
}
