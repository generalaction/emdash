/**
 * Tests for the `emdash://projects` (static) and
 * `emdash://projects/{projectId}/tasks` (templated) resources.
 *
 * Drives a real `McpServer` instance; deps are injected via
 * `_setProjectResourceDeps` so we don't pull the real DB / electron at
 * import time (the resource module itself uses the lazy `loadDeps()`
 * pattern — same as `tools/task-tools.ts`).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import type { Task } from '@shared/tasks';
import {
  _resetProjectResourceDeps,
  _setProjectResourceDeps,
  registerProjectResource,
} from './project-resource';

type ServerInternals = {
  _registeredResources: Record<
    string,
    {
      name: string;
      metadata: { mimeType?: string };
      readCallback: (
        uri: URL,
        extra: unknown
      ) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>;
    }
  >;
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

function makeLocalProject(overrides: Partial<LocalProject> = {}): LocalProject {
  const base: LocalProject = {
    type: 'local',
    id: 'proj-1',
    name: 'Demo project',
    path: '/tmp/demo',
    baseRef: 'main',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
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

describe('project-resource', () => {
  afterEach(() => {
    _resetProjectResourceDeps();
  });

  describe('emdash://projects (collection)', () => {
    it('registers a static resource at emdash://projects with application/json mime', () => {
      const server = makeServer();
      registerProjectResource(server);
      const internals = server as unknown as ServerInternals;
      const entry = internals._registeredResources['emdash://projects'];
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('projects');
      expect(entry!.metadata.mimeType).toBe('application/json');
    });

    it('read returns the project list as JSON', async () => {
      const server = makeServer();
      const project = makeLocalProject();
      _setProjectResourceDeps({
        getProjects: vi.fn().mockResolvedValue([project]),
        getTasks: vi.fn().mockResolvedValue([]),
      });
      registerProjectResource(server);

      const internals = server as unknown as ServerInternals;
      const entry = internals._registeredResources['emdash://projects']!;
      const uri = new URL('emdash://projects');
      const result = await entry.readCallback(uri, {});

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.uri).toBe('emdash://projects');
      expect(result.contents[0]!.mimeType).toBe('application/json');
      expect(JSON.parse(result.contents[0]!.text)).toEqual([project]);
    });
  });

  describe('emdash://projects/{projectId}/tasks (template)', () => {
    it('registers a templated resource at emdash://projects/{projectId}/tasks', () => {
      const server = makeServer();
      registerProjectResource(server);
      const internals = server as unknown as ServerInternals;
      const entry = internals._registeredResourceTemplates['project-tasks'];
      expect(entry).toBeDefined();
      expect(entry!.resourceTemplate.uriTemplate.toString()).toBe(
        'emdash://projects/{projectId}/tasks'
      );
      expect(entry!.metadata.mimeType).toBe('application/json');
    });

    it('read returns the task list scoped to the projectId', async () => {
      const server = makeServer();
      const task = makeTask();
      const getTasks = vi.fn().mockResolvedValue([task]);
      _setProjectResourceDeps({
        getProjects: vi.fn().mockResolvedValue([]),
        getTasks,
      });
      registerProjectResource(server);

      const internals = server as unknown as ServerInternals;
      const entry = internals._registeredResourceTemplates['project-tasks']!;
      const uri = new URL('emdash://projects/proj-1/tasks');
      const result = await entry.readCallback(uri, { projectId: 'proj-1' }, {});

      expect(getTasks).toHaveBeenCalledWith('proj-1');
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.uri).toBe('emdash://projects/proj-1/tasks');
      expect(result.contents[0]!.mimeType).toBe('application/json');
      expect(JSON.parse(result.contents[0]!.text)).toEqual([task]);
    });
  });
});
