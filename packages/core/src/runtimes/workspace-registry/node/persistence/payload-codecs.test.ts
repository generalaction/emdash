import { describe, expect, it } from 'vitest';
import type { WorkspaceCreation, WorkspaceLifecycle } from '../../api/schemas';
import {
  parseCreationPayload,
  parseLifecyclePayload,
  serializeCreationPayload,
  serializeLifecyclePayload,
} from './payload-codecs';

describe('creation payload codec', () => {
  it('round-trips a creation section carrying gitSetup and a null baseRef', () => {
    const creation: WorkspaceCreation = {
      branch: 'pr/7/fix',
      baseRef: null,
      requestedPath: '/tmp/pr-wt',
      gitSetup: {
        fetchBranch: { remote: 'origin', sourceRef: 'refs/pull/7/head' },
        upstream: { remote: 'origin', mergeRef: 'refs/pull/7/head' },
        breadcrumb: { prUrl: 'https://github.com/acme/repo/pull/7' },
        followRef: true,
      },
    };
    expect(parseCreationPayload(serializeCreationPayload(creation))).toEqual(creation);
  });

  it('parses a pre-gitSetup v1 creation payload unchanged', () => {
    // The exact JSON an old row stored: required baseRef, no gitSetup field.
    const v1 = JSON.stringify({
      version: '1',
      value: { branch: 'feature/x', baseRef: 'main', requestedPath: '/tmp/wt' },
    });
    expect(parseCreationPayload(v1)).toEqual({
      branch: 'feature/x',
      baseRef: 'main',
      requestedPath: '/tmp/wt',
    });
  });
});

describe('lifecycle payload codec', () => {
  it('round-trips the current lifecycle shape', () => {
    const lifecycle: WorkspaceLifecycle = {
      steps: [
        {
          id: 'create-worktree',
          status: 'succeeded',
          startedAt: 1_000,
          finishedAt: 2_000,
          params: { path: '/tmp/wt', branch: 'feature/x', branchCreated: true },
        },
        {
          id: 'push-branch',
          status: 'pending',
          startedAt: null,
          finishedAt: null,
          params: { branch: 'feature/x' },
        },
      ],
      preservePatterns: ['.env'],
    };
    expect(parseLifecyclePayload(serializeLifecyclePayload(lifecycle))).toEqual(lifecycle);
  });

  it('upgrades a v1 background payload into lifecycle steps best-effort', () => {
    // The exact JSON an old row stored: fixed per-step slots, one `at` stamp each.
    const v1 = JSON.stringify({
      version: '1',
      value: {
        steps: {
          cloneArtifacts: { status: 'succeeded', at: 5_000 },
          pushBranch: { status: 'failed', at: 6_000, message: 'no remote' },
          fetchRefs: { status: 'running', at: 7_000 },
        },
        preservePatterns: ['.env', '.envrc'],
      },
    });
    expect(parseLifecyclePayload(v1)).toEqual({
      steps: [
        {
          id: 'copy-artifacts',
          status: 'succeeded',
          startedAt: 5_000,
          finishedAt: 5_000,
          params: {},
        },
        {
          id: 'push-branch',
          status: 'failed',
          startedAt: 6_000,
          finishedAt: 6_000,
          message: 'no remote',
          params: {},
        },
        { id: 'fetch-refs', status: 'running', startedAt: 7_000, finishedAt: null, params: {} },
      ],
      preservePatterns: ['.env', '.envrc'],
    });
  });

  it('maps never-requested v1 slots to absent steps', () => {
    const v1 = JSON.stringify({
      version: '1',
      value: {
        steps: {
          cloneArtifacts: { status: 'pending', at: 5_000 },
          pushBranch: null,
          fetchRefs: null,
        },
        preservePatterns: [],
      },
    });
    expect(parseLifecyclePayload(v1)).toEqual({
      steps: [
        { id: 'copy-artifacts', status: 'pending', startedAt: null, finishedAt: null, params: {} },
      ],
      preservePatterns: [],
    });
  });
});
