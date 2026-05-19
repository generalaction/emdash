/**
 * Tests for the `emdash://tasks/{taskId}` resource.
 *
 * Drives a real `McpServer` instance; deps are injected via
 * `_setTaskResourceDeps` so we don't pull the real DB / electron at import
 * time (the resource module itself uses the lazy `loadDeps()` pattern —
 * same as `tools/task-tools.ts`).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import {
  _resetTaskResourceDeps,
  _setTaskResourceDeps,
  registerTaskResource,
} from './task-resource';

type ServerInternals = {
  _registeredResourceTemplates: Record<
    string,
    {
      resourceTemplate: { uriTemplate: { toString(): string } };
      metadata: { mimeType?: string };
      readCallback: (
        uri: URL,
        variables: Record<string, string>,
        extra: unknown
      ) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>;
    }
  >;
};

function makeServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: 'task-1',
    projectId: 'proj-1',
    name: 'My task',
    status: 'in_progress',
    sourceBranch: { type: 'local', branch: 'main' },
    taskBranch: 'feat/my-task',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
  };
  return { ...base, ...overrides };
}

describe('task-resource', () => {
  afterEach(() => {
    _resetTaskResourceDeps();
  });

  it('registers a templated resource at emdash://tasks/{taskId} with application/json mime', () => {
    const server = makeServer();
    registerTaskResource(server);
    const internals = server as unknown as ServerInternals;
    const entry = internals._registeredResourceTemplates['task'];
    expect(entry).toBeDefined();
    expect(entry!.resourceTemplate.uriTemplate.toString()).toBe('emdash://tasks/{taskId}');
    expect(entry!.metadata.mimeType).toBe('application/json');
  });

  it('read returns the matching task as JSON', async () => {
    const server = makeServer();
    const target = makeTask({ id: 'task-2', name: 'Other task' });
    _setTaskResourceDeps({
      getTasks: vi.fn().mockResolvedValue([makeTask(), target, makeTask({ id: 'task-3' })]),
    });
    registerTaskResource(server);

    const internals = server as unknown as ServerInternals;
    const entry = internals._registeredResourceTemplates['task']!;
    const uri = new URL('emdash://tasks/task-2');
    const result = await entry.readCallback(uri, { taskId: 'task-2' }, {});

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]!.uri).toBe('emdash://tasks/task-2');
    expect(result.contents[0]!.mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0]!.text)).toEqual(target);
  });

  it('read returns null payload when the task is unknown', async () => {
    const server = makeServer();
    _setTaskResourceDeps({
      getTasks: vi.fn().mockResolvedValue([makeTask({ id: 'other' })]),
    });
    registerTaskResource(server);

    const internals = server as unknown as ServerInternals;
    const entry = internals._registeredResourceTemplates['task']!;
    const uri = new URL('emdash://tasks/missing');
    const result = await entry.readCallback(uri, { taskId: 'missing' }, {});

    expect(JSON.parse(result.contents[0]!.text)).toBeNull();
  });
});
